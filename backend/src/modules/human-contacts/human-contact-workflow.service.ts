import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { HumanContactStatus, MessageDirection, MessageSenderType, OperatorStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedOperator } from '../auth/auth.types';

import { HumanContactListQuery } from './dto/human-contact.dto';

const ASSIGNABLE_STATUSES: HumanContactStatus[] = [HumanContactStatus.PENDING, HumanContactStatus.ASSIGNED];

@Injectable()
export class HumanContactWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: HumanContactListQuery, actor: AuthenticatedOperator) {
    const requests = await this.prisma.humanContactRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(this.canManageContacts(actor)
          ? query.assignee
            ? { currentAssigneeId: query.assignee }
            : {}
          : { currentAssigneeId: actor.id }),
        ...(query.conversationId ? { conversationId: query.conversationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.listInclude(),
    });
    return requests.map((request) => this.toListItem(request));
  }

  async detail(requestId: string, actor: AuthenticatedOperator) {
    const request = await this.prisma.humanContactRequest.findUnique({
      where: { id: requestId },
      include: this.detailInclude(),
    });
    if (!request) throw new NotFoundException('Human contact request was not found');
    this.assertVisibility(request, actor);

    return {
      ...this.toListItem({ ...request, conversation: { ...request.conversation, messages: request.conversation.messages.filter((message) => message.senderType === MessageSenderType.USER).slice(-1) } }),
      fullName: request.fullName,
      phoneNumber: request.phoneNumber,
      context: request.context,
      messages: request.conversation.messages,
      assignments: request.assignments,
      events: request.events,
      internalNotes: request.events.filter((event) => event.action === 'NOTE_ADDED').map((event) => ({
        id: event.id,
        note: event.note,
        operatorId: event.operatorId,
        createdAt: event.createdAt,
      })),
      replies: request.events
        .filter((event) => event.action === 'REPLIED')
        .map((event) => ({ messageId: this.getEventMessageId(event.data), operatorId: event.operatorId, createdAt: event.createdAt })),
    };
  }

  async assign(requestId: string, targetOperatorId: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const [request, target] = await Promise.all([
        transaction.humanContactRequest.findUnique({ where: { id: requestId } }),
        transaction.operator.findUnique({ where: { id: targetOperatorId } }),
      ]);
      if (!request) throw new NotFoundException('Human contact request was not found');
      if (!target) throw new NotFoundException('Operator was not found');
      if (target.status !== OperatorStatus.ACTIVE) throw new ConflictException('Operator is not active');
      if (!ASSIGNABLE_STATUSES.includes(request.status)) {
        throw new ConflictException(`Human contact request in ${request.status} cannot be assigned`);
      }
      if (request.status === HumanContactStatus.ASSIGNED && request.currentAssigneeId === targetOperatorId) return request;

      if (request.currentAssigneeId) {
        await transaction.humanContactAssignment.updateMany({
          where: { requestId, operatorId: request.currentAssigneeId, endedAt: null },
          data: { endedAt: new Date() },
        });
      }
      await transaction.humanContactAssignment.create({
        data: { requestId, operatorId: targetOperatorId, assignedByOperatorId: actor.id },
      });
      const updatedRequest = await transaction.humanContactRequest.update({
        where: { id: requestId },
        data: { currentAssigneeId: targetOperatorId, status: HumanContactStatus.ASSIGNED, assignedAt: new Date() },
      });
      await this.createEvent(transaction, {
        requestId,
        operatorId: actor.id,
        action: request.currentAssigneeId ? 'REASSIGNED' : 'ASSIGNED',
        fromStatus: request.status,
        toStatus: HumanContactStatus.ASSIGNED,
      });
      return updatedRequest;
    });
  }

  async start(requestId: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const request = await transaction.humanContactRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Human contact request was not found');
      this.assertActor(request, actor);
      this.assertTransition(request.status, HumanContactStatus.ASSIGNED, HumanContactStatus.CONTACTED);
      const updatedRequest = await transaction.humanContactRequest.update({
        where: { id: requestId },
        data: { status: HumanContactStatus.CONTACTED, contactedAt: new Date() },
      });
      await this.createEvent(transaction, {
        requestId,
        operatorId: actor.id,
        action: 'STARTED',
        fromStatus: HumanContactStatus.ASSIGNED,
        toStatus: HumanContactStatus.CONTACTED,
      });
      return updatedRequest;
    });
  }

  async addNote(requestId: string, note: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const request = await transaction.humanContactRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Human contact request was not found');
      this.assertActor(request, actor);
      this.assertActiveHandling(request.status, 'add a note');
      return this.createEvent(transaction, {
        requestId,
        operatorId: actor.id,
        action: 'NOTE_ADDED',
        fromStatus: request.status,
        toStatus: request.status,
        note,
      });
    });
  }

  async reply(requestId: string, message: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const request = await transaction.humanContactRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Human contact request was not found');
      this.assertActor(request, actor);
      this.assertActiveHandling(request.status, 'reply to this request');
      const conversation = await transaction.conversation.findUnique({
        where: { id: request.conversationId },
        include: { chatUser: { select: { channel: true } } },
      });
      if (!conversation) throw new ConflictException('Human contact conversation was not found');
      const outboundMessage = await transaction.message.create({
        data: {
          conversationId: request.conversationId,
          channel: conversation.chatUser.channel,
          senderType: MessageSenderType.OPERATOR,
          direction: MessageDirection.OUTBOUND,
          content: message,
        },
      });
      await transaction.conversation.update({ where: { id: request.conversationId }, data: { lastMessageAt: new Date() } });
      await this.createEvent(transaction, {
        requestId,
        operatorId: actor.id,
        action: 'REPLIED',
        fromStatus: request.status,
        toStatus: request.status,
        data: { messageId: outboundMessage.id },
      });
      return { requestId, outboundMessageId: outboundMessage.id };
    });
  }

  async close(requestId: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const request = await transaction.humanContactRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Human contact request was not found');
      this.assertActor(request, actor);
      this.assertTransition(request.status, HumanContactStatus.CONTACTED, HumanContactStatus.RESOLVED);
      const completion = await transaction.humanContactRequest.updateMany({
        where: { id: requestId, status: HumanContactStatus.CONTACTED },
        data: { status: HumanContactStatus.RESOLVED, resolvedAt: new Date() },
      });
      if (completion.count !== 1) throw new ConflictException('Human contact request was already resolved or changed');
      await this.createEvent(transaction, {
        requestId,
        operatorId: actor.id,
        action: 'RESOLVED',
        fromStatus: HumanContactStatus.CONTACTED,
        toStatus: HumanContactStatus.RESOLVED,
      });
      return { requestId, status: HumanContactStatus.RESOLVED };
    });
  }

  private listInclude() {
    return {
      currentAssignee: { select: { id: true, fullName: true, email: true } },
      conversation: {
        select: {
          id: true,
          chatUser: { select: { channel: true, externalUserId: true } },
          messages: {
            where: { senderType: MessageSenderType.USER },
            orderBy: { createdAt: 'desc' as const },
            take: 1,
            select: { id: true, content: true, createdAt: true },
          },
        },
      },
    };
  }

  private detailInclude() {
    return {
      currentAssignee: { select: { id: true, fullName: true, email: true } },
      conversation: {
        select: {
          id: true,
          chatUser: { select: { channel: true, externalUserId: true } },
          messages: { orderBy: { createdAt: 'asc' as const }, select: { id: true, senderType: true, direction: true, content: true, createdAt: true } },
        },
      },
      assignments: {
        orderBy: { assignedAt: 'asc' as const },
        include: {
          operator: { select: { id: true, fullName: true, email: true } },
          assignedByOperator: { select: { id: true, fullName: true, email: true } },
        },
      },
      events: { orderBy: { createdAt: 'asc' as const } },
    };
  }

  private toListItem(request: any) {
    return {
      id: request.id,
      status: request.status,
      priority: request.priority,
      createdAt: request.createdAt,
      conversationId: request.conversation.id,
      assignee: request.currentAssignee,
      reason: request.reason,
      channel: request.conversation.chatUser.channel,
      externalUserId: request.conversation.chatUser.externalUserId,
      latestUserMessage: request.conversation.messages[0] ?? null,
      assignedAt: request.assignedAt,
      contactedAt: request.contactedAt,
      resolvedAt: request.resolvedAt,
    };
  }

  private canManageContacts(actor: AuthenticatedOperator): boolean {
    return actor.permissions.includes('contact.assign');
  }

  private assertVisibility(request: { currentAssigneeId: string | null }, actor: AuthenticatedOperator): void {
    if (request.currentAssigneeId !== actor.id && !this.canManageContacts(actor)) {
      throw new ForbiddenException('You are not allowed to view this human contact request');
    }
  }

  private assertActor(request: { currentAssigneeId: string | null }, actor: AuthenticatedOperator): void {
    if (request.currentAssigneeId !== actor.id && !this.canManageContacts(actor)) {
      throw new ForbiddenException('You are not assigned to this human contact request');
    }
  }

  private assertTransition(current: HumanContactStatus, expected: HumanContactStatus, next: HumanContactStatus): void {
    if (current !== expected) throw new ConflictException(`Invalid human contact transition: ${current} to ${next}`);
  }

  private assertActiveHandling(status: HumanContactStatus, action: string): void {
    if (status !== HumanContactStatus.CONTACTED) {
      throw new ConflictException(`Human contact request must be CONTACTED to ${action}`);
    }
  }

  private async createEvent(transaction: any, event: any): Promise<any> {
    return transaction.humanContactEvent.create({ data: event });
  }

  private getEventMessageId(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const messageId = (value as Record<string, unknown>).messageId;
    return typeof messageId === 'string' ? messageId : null;
  }
}
