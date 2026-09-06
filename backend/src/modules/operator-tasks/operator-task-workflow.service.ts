import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import {
  MessageDirection,
  MessageSenderType,
  OperatorStatus,
  OperatorTaskStatus,
  TaskResponseStatus,
} from '../../generated/prisma/client';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedOperator } from '../auth/auth.types';

import { OperatorTaskListQuery } from './dto/operator-task.dto';

const MAX_DRAFT_LENGTH = 4_000;
const ASSIGNABLE_TASK_STATUSES: OperatorTaskStatus[] = [OperatorTaskStatus.PENDING, OperatorTaskStatus.ASSIGNED];

const TASK_TRANSITIONS: Partial<Record<OperatorTaskStatus, OperatorTaskStatus[]>> = {
  [OperatorTaskStatus.PENDING]: [OperatorTaskStatus.ASSIGNED],
  [OperatorTaskStatus.ASSIGNED]: [OperatorTaskStatus.IN_PROGRESS],
  [OperatorTaskStatus.IN_PROGRESS]: [OperatorTaskStatus.COMPLETED],
};

@Injectable()
export class OperatorTaskWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async list(query: OperatorTaskListQuery, actor: AuthenticatedOperator) {
    const tasks = await this.prisma.operatorTask.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(this.canManageTasks(actor)
          ? query.assignee
            ? { currentAssigneeId: query.assignee }
            : {}
          : { currentAssigneeId: actor.id }),
        ...(query.operatorTaskType ? { taskType: query.operatorTaskType } : {}),
        ...(query.conversationId ? { conversationId: query.conversationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.taskListInclude(),
    });

    return tasks.map((task) => this.toTaskListItem(task));
  }

  async detail(taskId: string, actor: AuthenticatedOperator) {
    const task = await this.prisma.operatorTask.findUnique({
      where: { id: taskId },
      include: this.taskDetailInclude(),
    });

    if (!task) throw new NotFoundException('Operator task was not found');
    this.assertTaskVisibility(task, actor);

    return this.toTaskDetail(task);
  }

  async assign(taskId: string, operatorId: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const [task, operator] = await Promise.all([
        transaction.operatorTask.findUnique({ where: { id: taskId } }),
        transaction.operator.findUnique({ where: { id: operatorId } }),
      ]);
      if (!task) throw new NotFoundException('Operator task was not found');
      if (!operator) throw new NotFoundException('Operator was not found');
      if (operator.status !== OperatorStatus.ACTIVE) throw new ConflictException('Operator is not active');
      if (task.status === OperatorTaskStatus.COMPLETED) throw new ConflictException('Completed tasks cannot be assigned');
      if (!ASSIGNABLE_TASK_STATUSES.includes(task.status)) {
        throw new ConflictException(`Task in ${task.status} cannot be assigned`);
      }
      if (task.status === OperatorTaskStatus.ASSIGNED && task.currentAssigneeId === operatorId) return task;

      if (task.status === OperatorTaskStatus.PENDING) {
        this.assertTransition(task.status, OperatorTaskStatus.ASSIGNED);
      }
      if (task.currentAssigneeId) {
        await transaction.operatorTaskAssignment.updateMany({
          where: { taskId, operatorId: task.currentAssigneeId, endedAt: null },
          data: { endedAt: new Date() },
        });
      }
      await transaction.operatorTaskAssignment.create({ data: { taskId, operatorId, assignedByOperatorId: actor.id } });
      const updatedTask = await transaction.operatorTask.update({
        where: { id: taskId },
        data: { currentAssigneeId: operatorId, status: OperatorTaskStatus.ASSIGNED, assignedAt: new Date() },
      });
      await this.createEvent(transaction, {
        taskId,
        operatorId: actor.id,
        action: task.currentAssigneeId ? 'REASSIGNED' : 'ASSIGNED',
        fromStatus: task.status,
        toStatus: OperatorTaskStatus.ASSIGNED,
      });

      return updatedTask;
    });
  }

  async start(taskId: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.operatorTask.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Operator task was not found');
      if (!task.currentAssigneeId) throw new ConflictException('Task must be assigned before it can start');
      this.assertTaskActor(task, actor);
      this.assertTransition(task.status, OperatorTaskStatus.IN_PROGRESS);

      const updatedTask = await transaction.operatorTask.update({
        where: { id: taskId },
        data: { status: OperatorTaskStatus.IN_PROGRESS, startedAt: new Date() },
      });
      await this.createEvent(transaction, {
        taskId,
        operatorId: actor.id,
        action: 'STARTED',
        fromStatus: task.status,
        toStatus: OperatorTaskStatus.IN_PROGRESS,
      });
      return updatedTask;
    });
  }

  async submitResult(taskId: string, input: { result: string; outcome: string | null }, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.operatorTask.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Operator task was not found');
      this.assertTaskActor(task, actor);
      this.assertStatus(task.status, OperatorTaskStatus.IN_PROGRESS, 'submit an operational result');

      const updatedTask = await transaction.operatorTask.update({
        where: { id: taskId },
        data: {
          resultSummary: input.result,
          resultData: { outcome: input.outcome, result: input.result },
        },
      });
      await transaction.operatorTaskResponse.updateMany({
        where: { taskId, status: { in: [TaskResponseStatus.GENERATED, TaskResponseStatus.EDITED] } },
        data: { status: TaskResponseStatus.FAILED },
      });
      await this.createEvent(transaction, {
        taskId,
        operatorId: actor.id,
        action: 'RESULT_SUBMITTED',
        fromStatus: task.status,
        toStatus: task.status,
      });
      return updatedTask;
    });
  }

  async generateResponse(taskId: string, actor: AuthenticatedOperator) {
    const task = await this.prisma.operatorTask.findUnique({
      where: { id: taskId },
      include: {
        knowledgeItemVersion: {
          include: { knowledgeItem: { select: { code: true } } },
        },
      },
    });
    if (!task) throw new NotFoundException('Operator task was not found');
    this.assertTaskActor(task, actor);
    this.assertStatus(task.status, OperatorTaskStatus.IN_PROGRESS, 'generate a response draft');
    if (!task.resultSummary) throw new ConflictException('An operator result is required before generating a response');

    const authoritativeInput = this.createDraftInput(task);
    // The LLM call intentionally occurs before the short persistence transaction below.
    const rawDraft = await this.llmService.generateStructured({
      systemPrompt:
        'Return JSON only with exactly one key, draftResponse. Transform only the supplied authoritative facts into a customer-facing Vietnamese response. Do not add facts, actions, dates, identifiers, URLs, internal instructions, task IDs, or claims not stated in operatorResult.',
      userPrompt: JSON.stringify(authoritativeInput),
      metadata: { purpose: 'operator_response_generation', correlationId: taskId },
    });
    const draftResponse = this.validateDraft(rawDraft);

    return this.prisma.$transaction(async (transaction) => {
      const currentTask = await transaction.operatorTask.findUnique({ where: { id: taskId } });
      if (!currentTask) throw new NotFoundException('Operator task was not found');
      this.assertTaskActor(currentTask, actor);
      this.assertStatus(currentTask.status, OperatorTaskStatus.IN_PROGRESS, 'save a response draft');
      if (currentTask.resultSummary !== task.resultSummary) {
        throw new ConflictException('The operator result changed; generate a new draft from the current result');
      }

      const response = await transaction.operatorTaskResponse.create({
        data: { taskId, aiGeneratedText: draftResponse, status: TaskResponseStatus.GENERATED },
      });
      await this.createEvent(transaction, {
        taskId,
        operatorId: actor.id,
        action: 'DRAFT_GENERATED',
        fromStatus: currentTask.status,
        toStatus: currentTask.status,
      });
      return response;
    });
  }

  async editDraft(taskId: string, draftResponse: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.operatorTask.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Operator task was not found');
      this.assertTaskActor(task, actor);
      this.assertStatus(task.status, OperatorTaskStatus.IN_PROGRESS, 'edit a response draft');
      const response = await transaction.operatorTaskResponse.findFirst({
        where: { taskId, status: { in: [TaskResponseStatus.GENERATED, TaskResponseStatus.EDITED] } },
        orderBy: { createdAt: 'desc' },
      });
      if (!response) throw new ConflictException('No editable response draft exists');

      const updatedResponse = await transaction.operatorTaskResponse.update({
        where: { id: response.id },
        data: { finalText: draftResponse, status: TaskResponseStatus.EDITED },
      });
      await this.createEvent(transaction, {
        taskId,
        operatorId: actor.id,
        action: 'DRAFT_EDITED',
        fromStatus: task.status,
        toStatus: task.status,
      });
      return updatedResponse;
    });
  }

  async approve(taskId: string, actor: AuthenticatedOperator) {
    return this.prisma.$transaction(async (transaction) => {
      const [task, approver] = await Promise.all([
        transaction.operatorTask.findUnique({ where: { id: taskId } }),
        transaction.operator.findUnique({ where: { id: actor.id } }),
      ]);
      if (!task) throw new NotFoundException('Operator task was not found');
      this.assertTaskActor(task, actor);
      if (!approver) throw new NotFoundException('Operator was not found');
      if (approver.status !== OperatorStatus.ACTIVE) throw new ConflictException('Operator is not active');
      this.assertTransition(task.status, OperatorTaskStatus.COMPLETED);

      const response = await transaction.operatorTaskResponse.findFirst({
        where: { taskId, status: { in: [TaskResponseStatus.GENERATED, TaskResponseStatus.EDITED] } },
        orderBy: { createdAt: 'desc' },
      });
      if (!response) throw new ConflictException('A generated or edited response draft is required before approval');
      const finalText = (response.finalText ?? response.aiGeneratedText).trim();
      if (!finalText) throw new ConflictException('A non-empty response draft is required before approval');

      const conversation = await transaction.conversation.findUnique({
        where: { id: task.conversationId },
        include: { chatUser: { select: { channel: true } } },
      });
      if (!conversation) throw new ConflictException('Task conversation was not found');

      const outboundMessage = await transaction.message.create({
        data: {
          conversationId: task.conversationId,
          channel: conversation.chatUser.channel,
          senderType: MessageSenderType.OPERATOR,
          direction: MessageDirection.OUTBOUND,
          content: finalText,
        },
      });
      await transaction.conversation.update({
        where: { id: task.conversationId },
        data: { lastMessageAt: new Date() },
      });
      const completion = await transaction.operatorTask.updateMany({
        where: { id: taskId, status: OperatorTaskStatus.IN_PROGRESS },
        data: { status: OperatorTaskStatus.COMPLETED, completedAt: new Date() },
      });
      if (completion.count !== 1) throw new ConflictException('Task was already completed or changed by another request');

      await transaction.operatorTaskResponse.update({
        where: { id: response.id },
        data: {
          finalText,
          status: TaskResponseStatus.APPROVED,
          approvedByOperatorId: actor.id,
          approvedAt: new Date(),
          sentMessageId: outboundMessage.id,
        },
      });
      await this.createEvent(transaction, {
        taskId,
        operatorId: actor.id,
        action: 'COMPLETED',
        fromStatus: OperatorTaskStatus.IN_PROGRESS,
        toStatus: OperatorTaskStatus.COMPLETED,
      });
      return { taskId, status: OperatorTaskStatus.COMPLETED, outboundMessageId: outboundMessage.id };
    });
  }

  private taskListInclude() {
    return {
      currentAssignee: { select: { id: true, fullName: true, email: true } },
      knowledgeItemVersion: { include: { knowledgeItem: { select: { code: true } } } },
      conversation: {
        select: {
          id: true,
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

  private taskDetailInclude() {
    return {
      currentAssignee: { select: { id: true, fullName: true, email: true } },
      knowledgeItemVersion: { include: { knowledgeItem: { select: { code: true } } } },
      conversation: {
        select: {
          id: true,
          messages: {
            orderBy: { createdAt: 'asc' as const },
            select: { id: true, senderType: true, direction: true, content: true, createdAt: true },
          },
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
      responses: { orderBy: { createdAt: 'desc' as const } },
    };
  }

  private toTaskListItem(task: any) {
    const input = this.getTaskInput(task.inputData);
    return {
      id: task.id,
      taskCode: task.taskCode,
      status: task.status,
      operatorTaskType: task.taskType,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      assignee: task.currentAssignee,
      selectedKnowledge: task.knowledgeItemVersion
        ? { code: task.knowledgeItemVersion.knowledgeItem.code, title: task.knowledgeItemVersion.title }
        : null,
      requiredFields: input.requiredFields,
      collectedFields: input.collectedFields,
      missingFields: input.missingFields,
      conversationId: task.conversation.id,
      latestUserMessage: task.conversation.messages[0] ?? null,
    };
  }

  private toTaskDetail(task: any) {
    const input = this.getTaskInput(task.inputData);
    const latestResponse = task.responses[0] ?? null;
    return {
      ...this.toTaskListItem({ ...task, conversation: { ...task.conversation, messages: task.conversation.messages.filter((message) => message.senderType === MessageSenderType.USER).slice(-1) } }),
      description: task.description,
      operatorInstruction: task.description,
      priority: task.priority,
      assignedAt: task.assignedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      operatorResult: task.resultSummary
        ? { outcome: this.getTaskOutcome(task.resultData), result: task.resultSummary }
        : null,
      draft: latestResponse
        ? {
            id: latestResponse.id,
            aiGeneratedText: latestResponse.aiGeneratedText,
            finalText: latestResponse.finalText,
            status: latestResponse.status,
          }
        : null,
      messages: task.conversation.messages,
      assignments: task.assignments,
      events: task.events,
    };
  }

  private createDraftInput(task: any) {
    const outcome = this.getTaskOutcome(task.resultData);
    const knowledge = task.knowledgeItemVersion;
    const template =
      outcome === 'SUCCESS'
        ? knowledge?.successResponseTemplate
        : outcome === 'FAILURE'
          ? knowledge?.failureResponseTemplate
          : null;
    return {
      operatorResult: task.resultSummary,
      outcome,
      responseTemplate: template,
      knowledge: knowledge
        ? { code: knowledge.knowledgeItem.code, title: knowledge.title, content: this.boundText(knowledge.knowledgeContent, 6000) }
        : null,
    };
  }

  private validateDraft(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConflictException('LLM returned an invalid response draft');
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.draftResponse !== 'string') {
      throw new ConflictException('LLM returned an invalid response draft');
    }
    const draft = record.draftResponse.trim();
    if (!draft || draft.length > MAX_DRAFT_LENGTH) {
      throw new ConflictException('LLM returned an empty or oversized response draft');
    }
    return draft;
  }

  private assertTransition(from: OperatorTaskStatus, to: OperatorTaskStatus): void {
    if (!TASK_TRANSITIONS[from]?.includes(to)) {
      throw new ConflictException(`Invalid task transition: ${from} to ${to}`);
    }
  }

  private assertStatus(current: OperatorTaskStatus, expected: OperatorTaskStatus, action: string): void {
    if (current !== expected) throw new ConflictException(`Task must be ${expected} to ${action}`);
  }

  private canManageTasks(actor: AuthenticatedOperator): boolean {
    return actor.permissions.includes('task.assign');
  }

  private assertTaskVisibility(task: { currentAssigneeId: string | null }, actor: AuthenticatedOperator): void {
    if (task.currentAssigneeId !== actor.id && !this.canManageTasks(actor)) {
      throw new ForbiddenException('You are not allowed to view this task');
    }
  }

  private assertTaskActor(task: { currentAssigneeId: string | null }, actor: AuthenticatedOperator): void {
    if (task.currentAssigneeId !== actor.id && !this.canManageTasks(actor)) {
      throw new ForbiddenException('You are not assigned to this task');
    }
  }

  private async createEvent(transaction: any, event: any): Promise<void> {
    await transaction.operatorTaskEvent.create({ data: event });
  }

  private getTaskInput(value: unknown) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return {
      requiredFields: Array.isArray(input.requiredFields) ? input.requiredFields.filter((field) => typeof field === 'string') : [],
      collectedFields:
        input.collectedFields && typeof input.collectedFields === 'object' && !Array.isArray(input.collectedFields)
          ? input.collectedFields
          : {},
      missingFields: Array.isArray(input.missingFields) ? input.missingFields.filter((field) => typeof field === 'string') : [],
    };
  }

  private getTaskOutcome(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const outcome = (value as Record<string, unknown>).outcome;
    return typeof outcome === 'string' ? outcome : null;
  }

  private boundText(value: string, limit: number): string {
    return value.length <= limit ? value : `${value.slice(0, limit)}…`;
  }
}
