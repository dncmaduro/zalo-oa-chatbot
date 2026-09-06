import { ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

import { ChatChannel, MessageDirection, MessageSenderType, OperatorTaskStatus, ResolutionType } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

import { extractExplicitFieldValues } from './task-field-collection.utils';

const ELIGIBLE_STATUSES: OperatorTaskStatus[] = [
  OperatorTaskStatus.PENDING,
  OperatorTaskStatus.ASSIGNED,
  OperatorTaskStatus.IN_PROGRESS,
];
const NAME_FIELDS = new Set(['họ tên', 'họ và tên']);
const NAME_PRONOUNS = new Set(['em', 'anh', 'chị', 'tôi', 'mình', 'bạn']);
const CONTINUATION_DECISION_MAX_OUTPUT_TOKENS = 96;
const ALL_FIELDS_COLLECTED_ACKNOWLEDGEMENT = 'Em đã nhận đủ thông tin. Bên em sẽ kiểm tra và phản hồi anh/chị sau nhé.';

interface TaskInputData {
  requiredFields: string[];
  collectedFields: Record<string, string>;
  missingFields: string[];
  [key: string]: unknown;
}

interface ContinuationCandidate {
  id: string;
  taskType: string;
  description: string | null;
  status: OperatorTaskStatus;
  input: TaskInputData;
  knowledge: { code: string; title: string; acknowledgementMessage: string | null } | null;
}

export interface TaskContinuationResult {
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId: string;
  resolutionType: 'OPERATOR_TASK';
  selectedKnowledge: { type: 'KNOWLEDGE_ITEM'; knowledgeCode: string } | null;
  response: string;
  operatorTask: { id: string; status: string };
  humanContactRequest: null;
  requiredFields: string[];
  collectedFields: Record<string, string>;
  missingFields: string[];
  isContinuation: true;
}

@Injectable()
export class TaskFieldCollectionService {
  private readonly logger = new Logger(TaskFieldCollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async tryContinue(params: {
    conversationId: string;
    inboundMessageId: string;
    channel: ChatChannel;
    message: string;
  }): Promise<TaskContinuationResult | null> {
    const startedAt = performance.now();
    const lookupStartedAt = performance.now();
    const candidates = await this.loadEligibleTasks(params.conversationId);
    const continuationLookupMs = this.elapsedMs(lookupStartedAt);
    if (candidates.length === 0) {
      this.logPerformance({
        conversationId: params.conversationId,
        inboundMessageId: params.inboundMessageId,
        candidateCount: 0,
        continuationLookupMs,
        continuationDecisionMs: 0,
        continuationPersistenceMs: 0,
        totalMs: this.elapsedMs(startedAt),
        isContinuation: false,
        systemPromptChars: 0,
        userPromptChars: 0,
        knowledgeItemCandidateCount: 0,
      });
      return null;
    }

    const explicitMatches = candidates.map((candidate) => ({
      candidate,
      extraction: extractExplicitFieldValues(params.message, candidate.input.requiredFields),
    }));
    const explicitlyMatched = explicitMatches.filter(({ extraction }) => extraction.matchedFields.length > 0);

    // This deliberately runs outside a transaction; it receives only compact task metadata.
    const decisionStartedAt = performance.now();
    const decision = await this.requestDecision(params.message, candidates, {
      conversationId: params.conversationId,
      inboundMessageId: params.inboundMessageId,
    });
    const continuationDecisionMs = this.elapsedMs(decisionStartedAt);
    const deterministicallySelected = explicitlyMatched.length === 1 ? explicitlyMatched[0] : null;
    if (decision.selectedTaskId === null && !deterministicallySelected) {
      this.logPerformance({
        conversationId: params.conversationId,
        inboundMessageId: params.inboundMessageId,
        candidateCount: candidates.length,
        continuationLookupMs,
        continuationDecisionMs,
        continuationPersistenceMs: 0,
        totalMs: this.elapsedMs(startedAt),
        isContinuation: false,
        ...decision.promptMetrics,
      });
      return null;
    }

    const selected = deterministicallySelected?.candidate ?? candidates.find((candidate) => candidate.id === decision.selectedTaskId);
    if (!selected) throw new InternalServerErrorException('LLM selected an ineligible continuation task.');
    const deterministicFields = deterministicallySelected?.extraction.collectedFields
      ?? extractExplicitFieldValues(params.message, selected.input.requiredFields).collectedFields;
    const llmFields = this.validateCollectedFields(decision.collectedFields, selected.input.requiredFields);
    const collectedFields = { ...llmFields, ...deterministicFields };

    const persistenceStartedAt = performance.now();
    const result = await this.persistContinuation({ ...params, selectedTaskId: selected.id, collectedFields });
    this.logPerformance({
      conversationId: params.conversationId,
      inboundMessageId: params.inboundMessageId,
      candidateCount: candidates.length,
      continuationLookupMs,
      continuationDecisionMs,
      continuationPersistenceMs: this.elapsedMs(persistenceStartedAt),
      totalMs: this.elapsedMs(startedAt),
      isContinuation: true,
      ...decision.promptMetrics,
    });
    return result;
  }

  private async loadEligibleTasks(conversationId: string): Promise<ContinuationCandidate[]> {
    const tasks = await this.prisma.operatorTask.findMany({
      where: {
        conversationId,
        status: { in: ELIGIBLE_STATUSES },
        resultSummary: null,
      },
      include: {
        knowledgeItemVersion: {
          include: { knowledgeItem: { select: { code: true } } },
        },
      },
    });

    return tasks
      .filter((task) => this.isEligible(task))
      .map((task) => {
        const input = this.toTaskInput(task.inputData);
        return {
          id: task.id,
          taskType: task.taskType,
          description: task.description,
          status: task.status,
          input,
          knowledge: task.knowledgeItemVersion
            ? {
                code: task.knowledgeItemVersion.knowledgeItem.code,
                title: task.knowledgeItemVersion.title,
                acknowledgementMessage: task.knowledgeItemVersion.acknowledgementMessage,
              }
            : null,
        };
      })
      .filter((task) => task.input.missingFields.length > 0);
  }

  private async requestDecision(
    message: string,
    candidates: ContinuationCandidate[],
    correlation: { conversationId: string; inboundMessageId: string },
  ) {
    const systemPrompt =
      'Return JSON only with exactly selectedTaskId and collectedFields. Select a task only if the user message clearly continues one supplied task; otherwise selectedTaskId must be null. Extract only explicit, unambiguous values for supplied required fields. Never return routing, status, response text, or invented fields.';
    const userPrompt = JSON.stringify({
      message,
      tasks: candidates.map((task) => ({
        id: task.id,
        taskType: task.taskType,
        description: this.boundText(task.description, 500),
        knowledge: task.knowledge ? { code: task.knowledge.code, title: task.knowledge.title } : null,
        requiredFields: task.input.requiredFields,
        collectedFields: task.input.collectedFields,
        missingFields: task.input.missingFields,
      })),
    });
    const raw = await this.llmService.generateStructured({
      systemPrompt,
      userPrompt,
      maxOutputTokens: CONTINUATION_DECISION_MAX_OUTPUT_TOKENS,
      metadata: {
        purpose: 'task_continuation',
        correlationId: `${correlation.conversationId}:${correlation.inboundMessageId}`,
      },
    });

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new InternalServerErrorException('LLM returned an invalid continuation decision.');
    }
    const decision = raw as Record<string, unknown>;
    if (Object.keys(decision).length !== 2 || !Object.prototype.hasOwnProperty.call(decision, 'selectedTaskId')) {
      throw new InternalServerErrorException('LLM returned an invalid continuation decision.');
    }
    const selectedTaskId = decision.selectedTaskId;
    if (selectedTaskId !== null && (typeof selectedTaskId !== 'string' || !candidates.some((task) => task.id === selectedTaskId))) {
      throw new InternalServerErrorException('LLM selected an invalid continuation task.');
    }
    if (!decision.collectedFields || typeof decision.collectedFields !== 'object' || Array.isArray(decision.collectedFields)) {
      throw new InternalServerErrorException('LLM returned invalid continuation fields.');
    }
    const collectedFields = decision.collectedFields as Record<string, unknown>;
    if (selectedTaskId === null && Object.keys(collectedFields).length > 0) {
      throw new InternalServerErrorException('LLM returned fields without a continuation task.');
    }

    return {
      selectedTaskId,
      collectedFields,
      promptMetrics: {
        systemPromptChars: systemPrompt.length,
        userPromptChars: userPrompt.length,
        knowledgeItemCandidateCount: candidates.filter((candidate) => candidate.knowledge !== null).length,
      },
    };
  }

  private async persistContinuation(params: {
    conversationId: string;
    inboundMessageId: string;
    channel: ChatChannel;
    selectedTaskId: string;
    collectedFields: Record<string, string>;
  }): Promise<TaskContinuationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.operatorTask.findUnique({
        where: { id: params.selectedTaskId },
        include: {
          knowledgeItemVersion: {
            include: { knowledgeItem: { select: { code: true } } },
          },
        },
      });
      if (!task || task.conversationId !== params.conversationId || !this.isEligible(task)) {
        throw new ConflictException('Continuation task is no longer eligible for field collection.');
      }

      const input = this.toTaskInput(task.inputData);
      const mergedFields = { ...input.collectedFields, ...params.collectedFields };
      const missingFields = input.requiredFields.filter((field) => !mergedFields[field]);
      const updatedInput = { ...input, collectedFields: mergedFields, missingFields };
      const updatedTask = await transaction.operatorTask.update({
        where: { id: task.id },
        data: { inputData: updatedInput },
      });
      const response = this.composeResponse(missingFields);
      const outboundMessage = await transaction.message.create({
        data: {
          conversationId: params.conversationId,
          channel: params.channel,
          senderType: MessageSenderType.BOT,
          direction: MessageDirection.OUTBOUND,
          content: response,
        },
      });
      await transaction.operatorTaskEvent.create({
        data: {
          taskId: task.id,
          action: 'FIELDS_UPDATED',
          fromStatus: task.status,
          toStatus: task.status,
          data: { fieldNames: Object.keys(params.collectedFields) },
        },
      });
      await transaction.conversation.update({
        where: { id: params.conversationId },
        data: { lastMessageAt: outboundMessage.createdAt },
      });

      return {
        conversationId: params.conversationId,
        inboundMessageId: params.inboundMessageId,
        outboundMessageId: outboundMessage.id,
        resolutionType: ResolutionType.OPERATOR_TASK,
        selectedKnowledge: task.knowledgeItemVersion
          ? { type: 'KNOWLEDGE_ITEM', knowledgeCode: task.knowledgeItemVersion.knowledgeItem.code }
          : null,
        response,
        operatorTask: { id: task.id, status: updatedTask.status },
        humanContactRequest: null,
        requiredFields: input.requiredFields,
        collectedFields: mergedFields,
        missingFields,
        isContinuation: true,
      };
    });
  }

  private isEligible(task: { status: OperatorTaskStatus; resultSummary: string | null; inputData: unknown }): boolean {
    return ELIGIBLE_STATUSES.includes(task.status) && task.resultSummary === null && this.toTaskInput(task.inputData).missingFields.length > 0;
  }

  private validateCollectedFields(value: Record<string, unknown>, requiredFields: string[]): Record<string, string> {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([field, fieldValue]) => requiredFields.includes(field) && typeof fieldValue === 'string')
        .map(([field, fieldValue]) => [field, (fieldValue as string).trim()])
        .filter(([field, fieldValue]) => fieldValue.length > 0 && !this.isStandaloneNamePronoun(field, fieldValue)),
    );
  }

  private isStandaloneNamePronoun(field: string, value: string): boolean {
    const normalizedField = field.trim().toLowerCase();
    const normalizedValue = value.trim().toLowerCase().replace(/[.,;:!?]+$/g, '');
    return NAME_FIELDS.has(normalizedField) && NAME_PRONOUNS.has(normalizedValue);
  }

  private toTaskInput(value: unknown): TaskInputData {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const requiredFields = Array.isArray(input.requiredFields)
      ? [...new Set(input.requiredFields.filter((field): field is string => typeof field === 'string' && Boolean(field.trim())).map((field) => field.trim()))]
      : [];
    const collectedFields =
      input.collectedFields && typeof input.collectedFields === 'object' && !Array.isArray(input.collectedFields)
        ? Object.fromEntries(
            Object.entries(input.collectedFields as Record<string, unknown>).filter(
              ([field, value]) => requiredFields.includes(field) && typeof value === 'string' && value.trim(),
            ),
          ) as Record<string, string>
        : {};
    const missingFields = requiredFields.filter((field) => !collectedFields[field]);
    return { ...input, requiredFields, collectedFields, missingFields };
  }

  private composeResponse(missingFields: string[]): string {
    if (missingFields.length === 0) {
      return ALL_FIELDS_COLLECTED_ACKNOWLEDGEMENT;
    }
    return `Anh/chị cho em xin thêm ${this.joinFields(missingFields)} để em kiểm tra nhé.`;
  }

  private joinFields(fields: string[]): string {
    if (fields.length === 1) return fields[0];
    if (fields.length === 2) return `${fields[0]} và ${fields[1]}`;
    return `${fields.slice(0, -1).join(', ')} và ${fields[fields.length - 1]}`;
  }

  private boundText(value: string | null, limit: number): string | null {
    if (!value || value.length <= limit) return value;
    return `${value.slice(0, limit)}…`;
  }

  private logPerformance(metrics: {
    conversationId: string;
    inboundMessageId: string;
    candidateCount: number;
    continuationLookupMs: number;
    continuationDecisionMs: number;
    continuationPersistenceMs: number;
    totalMs: number;
    isContinuation: boolean;
    systemPromptChars: number;
    userPromptChars: number;
    knowledgeItemCandidateCount: number;
  }): void {
    if (process.env.LLM_PERF_LOG?.trim().toLowerCase() !== 'true') return;
    this.logger.log(JSON.stringify({ event: 'task_continuation_performance', ...metrics }));
  }

  private elapsedMs(startedAt: number): number {
    return Math.round(performance.now() - startedAt);
  }
}
