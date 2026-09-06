import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  ConversationStatus,
  MessageDirection,
  MessageSenderType,
  ResolutionType,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { ChatResolveResult, ChatResolveService } from './chat-resolve.service';
import { NormalizedChatMessageInput } from './dto/create-chat-message.dto';
import { TaskFieldCollectionService } from './task-field-collection.service';

interface SelectedKnowledgeRecord {
  knowledgeItemVersionId: string | null;
  documentSectionId: string | null;
}

export interface ChatMessageResult {
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId: string;
  resolutionType: ResolutionType;
  selectedKnowledge: ChatResolveResult['selectedKnowledge'];
  response: string;
  operatorTask: { id: string; status: string } | null;
  humanContactRequest: { id: string; status: string } | null;
  requiredFields: string[];
  collectedFields: Record<string, string>;
  missingFields: string[];
  isContinuation?: boolean;
}

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatResolveService: ChatResolveService,
    private readonly taskFieldCollectionService: TaskFieldCollectionService,
  ) {}

  async handle(input: NormalizedChatMessageInput): Promise<ChatMessageResult> {
    const startedAt = performance.now();
    const inboundPersistenceStartedAt = performance.now();
    const { conversation, inboundMessage } = await this.persistInboundMessage(input);
    const inboundPersistenceMs = this.elapsedMs(inboundPersistenceStartedAt);

    const continuationStartedAt = performance.now();
    const continuation = await this.taskFieldCollectionService.tryContinue({
      conversationId: conversation.id,
      inboundMessageId: inboundMessage.id,
      channel: input.channel,
      message: input.message,
    });
    const continuationMs = this.elapsedMs(continuationStartedAt);
    if (continuation) {
      this.logPerformance({
        conversationId: conversation.id,
        inboundMessageId: inboundMessage.id,
        branch: 'continuation',
        inboundPersistenceMs,
        continuationMs,
        resolveMs: 0,
        resolutionPersistenceMs: 0,
        totalMs: this.elapsedMs(startedAt),
      });
      return continuation;
    }

    // Retrieval and LLM execution deliberately happen after the inbound transaction commits.
    const resolveStartedAt = performance.now();
    const resolution = await this.chatResolveService.resolve({
      message: input.message,
      audience: input.audience,
    }, { conversationId: conversation.id, inboundMessageId: inboundMessage.id });
    const resolveMs = this.elapsedMs(resolveStartedAt);
    const selectedKnowledge = await this.findSelectedKnowledge(resolution);

    const resolutionPersistenceStartedAt = performance.now();
    const result = await this.persistResolvedResult({
      input,
      conversationId: conversation.id,
      inboundMessageId: inboundMessage.id,
      resolution,
      selectedKnowledge,
    });
    this.logPerformance({
      conversationId: conversation.id,
      inboundMessageId: inboundMessage.id,
      branch: 'resolve',
      inboundPersistenceMs,
      continuationMs,
      resolveMs,
      resolutionPersistenceMs: this.elapsedMs(resolutionPersistenceStartedAt),
      totalMs: this.elapsedMs(startedAt),
    });
    return result;
  }

  private async persistInboundMessage(input: NormalizedChatMessageInput) {
    return this.prisma.$transaction(async (transaction) => {
      const chatUser = await transaction.chatUser.upsert({
        where: {
          channel_externalUserId: {
            channel: input.channel,
            externalUserId: input.externalUserId,
          },
        },
        create: {
          channel: input.channel,
          externalUserId: input.externalUserId,
        },
        update: {},
      });

      let conversation = await transaction.conversation.findFirst({
        where: {
          chatUserId: chatUser.id,
          status: ConversationStatus.ACTIVE,
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (!conversation) {
        conversation = await transaction.conversation.create({
          data: {
            chatUserId: chatUser.id,
            status: ConversationStatus.ACTIVE,
          },
        });
      }

      const inboundMessage = await transaction.message.create({
        data: {
          conversationId: conversation.id,
          channel: input.channel,
          senderType: MessageSenderType.USER,
          direction: MessageDirection.INBOUND,
          content: input.message,
        },
      });

      await transaction.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: inboundMessage.createdAt },
      });

      return { conversation, inboundMessage };
    });
  }

  private logPerformance(metrics: {
    conversationId: string;
    inboundMessageId: string;
    branch: 'continuation' | 'resolve';
    inboundPersistenceMs: number;
    continuationMs: number;
    resolveMs: number;
    resolutionPersistenceMs: number;
    totalMs: number;
  }): void {
    if (process.env.LLM_PERF_LOG?.trim().toLowerCase() !== 'true') return;
    this.logger.log(JSON.stringify({ event: 'chat_message_performance', ...metrics }));
  }

  private elapsedMs(startedAt: number): number {
    return Math.round(performance.now() - startedAt);
  }

  private async findSelectedKnowledge(resolution: ChatResolveResult): Promise<SelectedKnowledgeRecord> {
    if (!resolution.selectedKnowledge) {
      return { knowledgeItemVersionId: null, documentSectionId: null };
    }

    if (resolution.selectedKnowledge.type === 'KNOWLEDGE_ITEM') {
      const item = await this.prisma.knowledgeItem.findUnique({
        where: { code: resolution.selectedKnowledge.knowledgeCode },
        select: {
          currentPublishedVersion: { select: { id: true } },
        },
      });

      return { knowledgeItemVersionId: item?.currentPublishedVersion?.id ?? null, documentSectionId: null };
    }

    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { code: resolution.selectedKnowledge.documentCode },
      select: {
        currentPublishedVersion: {
          select: {
            sections: {
              where: { sectionCode: resolution.selectedKnowledge.sectionCode },
              select: { id: true },
            },
          },
        },
      },
    });
    const section = document?.currentPublishedVersion?.sections[0];

    return { knowledgeItemVersionId: null, documentSectionId: section?.id ?? null };
  }

  private async persistResolvedResult(params: {
    input: NormalizedChatMessageInput;
    conversationId: string;
    inboundMessageId: string;
    resolution: ChatResolveResult;
    selectedKnowledge: SelectedKnowledgeRecord;
  }): Promise<ChatMessageResult> {
    const { input, conversationId, inboundMessageId, resolution, selectedKnowledge } = params;

    return this.prisma.$transaction(async (transaction) => {
      const conversationResolution = await transaction.conversationResolution.create({
        data: {
          conversationId,
          triggerMessageId: inboundMessageId,
          knowledgeItemVersionId: selectedKnowledge.knowledgeItemVersionId,
          resolutionType: resolution.resolutionType,
          requiredFields: resolution.requiredFields,
          collectedFields: resolution.collectedFields,
        },
      });

      let operatorTask: { id: string; status: string } | null = null;
      let humanContactRequest: { id: string; status: string } | null = null;

      if (resolution.resolutionType === ResolutionType.OPERATOR_TASK) {
        const taskType = resolution.operatorTaskType ?? 'OPERATOR_TASK';
        const task = await transaction.operatorTask.create({
          data: {
            taskCode: `TASK-${randomUUID()}`,
            conversationId,
            resolutionId: conversationResolution.id,
            knowledgeItemVersionId: selectedKnowledge.knowledgeItemVersionId,
            taskType,
            title: taskType,
            description: resolution.operatorInstruction,
            inputData: {
              requiredFields: resolution.requiredFields,
              collectedFields: resolution.collectedFields,
              missingFields: resolution.missingFields,
              operatorInstruction: resolution.operatorInstruction,
              selectedKnowledge: resolution.selectedKnowledge,
            },
          },
        });
        operatorTask = { id: task.id, status: task.status };
      }

      if (resolution.resolutionType === ResolutionType.HUMAN_CONTACT) {
        const contactRequest = await transaction.humanContactRequest.create({
          data: {
            conversationId,
            resolutionId: conversationResolution.id,
            knowledgeItemVersionId: selectedKnowledge.knowledgeItemVersionId,
            reason: resolution.response,
            context: {
              triggerMessageId: inboundMessageId,
              selectedKnowledge: resolution.selectedKnowledge,
              requiredFields: resolution.requiredFields,
              collectedFields: resolution.collectedFields,
              missingFields: resolution.missingFields,
            },
          },
        });
        humanContactRequest = { id: contactRequest.id, status: contactRequest.status };
      }

      const outboundMessage = await transaction.message.create({
        data: {
          conversationId,
          channel: input.channel,
          senderType: MessageSenderType.BOT,
          direction: MessageDirection.OUTBOUND,
          content: resolution.response,
        },
      });

      if (selectedKnowledge.knowledgeItemVersionId) {
        await transaction.messageKnowledgeItemRef.create({
          data: {
            messageId: outboundMessage.id,
            knowledgeItemVersionId: selectedKnowledge.knowledgeItemVersionId,
          },
        });
      }

      if (selectedKnowledge.documentSectionId) {
        await transaction.messageKnowledgeSectionRef.create({
          data: {
            messageId: outboundMessage.id,
            sectionId: selectedKnowledge.documentSectionId,
          },
        });
      }

      await transaction.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: outboundMessage.createdAt },
      });

      return {
        conversationId,
        inboundMessageId,
        outboundMessageId: outboundMessage.id,
        resolutionType: resolution.resolutionType,
        selectedKnowledge: resolution.selectedKnowledge,
        response: resolution.response,
        operatorTask,
        humanContactRequest,
        requiredFields: resolution.requiredFields,
        collectedFields: resolution.collectedFields,
        missingFields: resolution.missingFields,
      };
    });
  }
}
