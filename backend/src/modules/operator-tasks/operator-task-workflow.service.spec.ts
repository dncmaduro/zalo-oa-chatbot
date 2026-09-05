import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  ChatChannel,
  MessageDirection,
  MessageSenderType,
  OperatorStatus,
  OperatorTaskStatus,
  TaskResponseStatus,
} from '../../generated/prisma/client';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../../prisma/prisma.service';

import { normalizeDraftResponse, normalizeSubmittedResult } from './dto/operator-task.dto';
import { OperatorTaskWorkflowService } from './operator-task-workflow.service';

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  taskCode: 'TASK-1',
  conversationId: 'conversation-1',
  knowledgeItemVersionId: 'knowledge-version-1',
  taskType: 'CHECK_NPP_SELECTION',
  title: 'Kiểm tra NPP',
  description: 'Kiểm tra NPP được chọn.',
  inputData: { requiredFields: ['Mã đơn'], collectedFields: { 'Mã đơn': 'SO-1' }, missingFields: [] },
  status: OperatorTaskStatus.PENDING,
  priority: 'NORMAL',
  currentAssigneeId: null,
  resultData: null,
  resultSummary: null,
  createdAt: new Date('2026-09-05T00:00:00.000Z'),
  updatedAt: new Date('2026-09-05T00:00:00.000Z'),
  assignedAt: null,
  startedAt: null,
  completedAt: null,
  ...overrides,
});

const activeOperator = { id: 'operator-1', status: OperatorStatus.ACTIVE, fullName: 'Nguyễn A', email: 'a@example.test' };

const createHarness = () => {
  const transaction = {
    operatorTask: {
      findUnique: jest.fn().mockResolvedValue(task()),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...task(), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    operator: { findUnique: jest.fn().mockResolvedValue(activeOperator) },
    operatorTaskAssignment: { create: jest.fn().mockResolvedValue({ id: 'assignment-1' }), updateMany: jest.fn() },
    operatorTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    operatorTaskResponse: {
      create: jest.fn().mockResolvedValue({ id: 'response-1', status: TaskResponseStatus.GENERATED }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'response-1',
        taskId: 'task-1',
        aiGeneratedText: 'Bản nháp AI.',
        finalText: null,
        status: TaskResponseStatus.GENERATED,
      }),
      update: jest.fn().mockResolvedValue({ id: 'response-1', status: TaskResponseStatus.EDITED }),
    },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ id: 'conversation-1', chatUser: { channel: ChatChannel.MOCK } }),
      update: jest.fn().mockResolvedValue({}),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'message-1' }) },
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn((callback) => callback(transaction)),
  };
  const llm = { generateStructured: jest.fn().mockResolvedValue({ draftResponse: 'Bản nháp AI.' }) };
  const service = new OperatorTaskWorkflowService(
    prisma as unknown as PrismaService,
    llm as unknown as LlmService,
  );
  return { service, prisma, transaction, llm };
};

describe('OperatorTaskWorkflowService', () => {
  describe('submit-result request validation', () => {
    it.each([
      ['undefined body', undefined],
      ['missing result', {}],
      ['empty result', { result: '' }],
      ['whitespace-only result', { result: '  \t ' }],
    ])('rejects %s with BadRequestException', (_description, body) => {
      expect(() => normalizeSubmittedResult(body)).toThrow(BadRequestException);
    });

    it('accepts a valid result without changing its existing normalization behavior', () => {
      expect(normalizeSubmittedResult({ outcome: 'SUCCESS', result: '  Đã xử lý.  ' })).toEqual({
        outcome: 'SUCCESS',
        result: 'Đã xử lý.',
      });
    });
  });

  it('lists pending tasks and returns task detail with operator metadata', async () => {
    const listedTask = {
      ...task(),
      currentAssignee: null,
      knowledgeItemVersion: { title: 'Kiểm tra NPP', knowledgeItem: { code: 'CHECK_NPP_SELECTION' } },
      conversation: { id: 'conversation-1', messages: [{ id: 'user-message', content: 'Kiểm tra đơn', createdAt: new Date() }] },
    };
    const detailedTask = {
      ...listedTask,
      conversation: {
        id: 'conversation-1',
        messages: [{ id: 'user-message', senderType: MessageSenderType.USER, direction: MessageDirection.INBOUND, content: 'Kiểm tra đơn', createdAt: new Date() }],
      },
      assignments: [],
      events: [],
      responses: [],
    };
    const { service, prisma } = createHarness();
    prisma.operatorTask.findMany.mockResolvedValue([listedTask]);
    prisma.operatorTask.findUnique.mockResolvedValue(detailedTask);

    await expect(service.list({ status: OperatorTaskStatus.PENDING })).resolves.toEqual([
      expect.objectContaining({ id: 'task-1', requiredFields: ['Mã đơn'], selectedKnowledge: { code: 'CHECK_NPP_SELECTION', title: 'Kiểm tra NPP' } }),
    ]);
    await expect(service.detail('task-1')).resolves.toEqual(
      expect.objectContaining({ id: 'task-1', operatorInstruction: 'Kiểm tra NPP được chọn.', messages: detailedTask.conversation.messages }),
    );
  });

  it('assigns an active operator, updates status, and preserves assignment history', async () => {
    const { service, transaction } = createHarness();

    await expect(service.assign('task-1', 'operator-1')).resolves.toMatchObject({ status: OperatorTaskStatus.ASSIGNED });

    expect(transaction.operatorTaskAssignment.create).toHaveBeenCalledWith({ data: { taskId: 'task-1', operatorId: 'operator-1' } });
    expect(transaction.operatorTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentAssigneeId: 'operator-1', status: OperatorTaskStatus.ASSIGNED }) }),
    );
    expect(transaction.operatorTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ASSIGNED' }) }),
    );
  });

  it('rejects a missing or inactive assignment target', async () => {
    const { service, transaction } = createHarness();
    transaction.operator.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...activeOperator, status: OperatorStatus.INACTIVE });

    await expect(service.assign('task-1', 'missing')).rejects.toThrow('Operator was not found');
    await expect(service.assign('task-1', 'inactive')).rejects.toThrow('Operator is not active');
  });

  it('starts an assigned task and rejects an invalid start transition', async () => {
    const { service, transaction } = createHarness();
    transaction.operatorTask.findUnique.mockResolvedValueOnce(task({ status: OperatorTaskStatus.ASSIGNED, currentAssigneeId: 'operator-1' }));

    await expect(service.start('task-1')).resolves.toMatchObject({ status: OperatorTaskStatus.IN_PROGRESS });
    expect(transaction.operatorTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'STARTED' }) }),
    );

    transaction.operatorTask.findUnique.mockResolvedValueOnce(task({ status: OperatorTaskStatus.PENDING }));
    await expect(service.start('task-1')).rejects.toThrow(ConflictException);
  });

  it('stores a trimmed operator result without generating a customer response', async () => {
    const { service, transaction, llm } = createHarness();
    transaction.operatorTask.findUnique.mockResolvedValue(task({ status: OperatorTaskStatus.IN_PROGRESS, currentAssigneeId: 'operator-1' }));

    await service.submitResult('task-1', { outcome: 'SUCCESS', result: 'Đã hướng dẫn chọn lại NPP Hải Phòng.' });

    expect(transaction.operatorTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resultSummary: 'Đã hướng dẫn chọn lại NPP Hải Phòng.' }) }),
    );
    expect(llm.generateStructured).not.toHaveBeenCalled();
    expect(() => normalizeSubmittedResult({ outcome: 'SUCCESS', result: '  ' })).toThrow('result must not be empty');
  });

  it('generates a structured draft from authoritative result and KB data outside a transaction', async () => {
    const resultTask = task({
      status: OperatorTaskStatus.IN_PROGRESS,
      currentAssigneeId: 'operator-1',
      resultSummary: 'Đã hướng dẫn chọn lại NPP Hải Phòng.',
      resultData: { outcome: 'SUCCESS', result: 'Đã hướng dẫn chọn lại NPP Hải Phòng.' },
      knowledgeItemVersion: {
        title: 'Kiểm tra NPP',
        knowledgeContent: 'Nội dung hướng dẫn KB.',
        successResponseTemplate: 'Mẫu thành công.',
        failureResponseTemplate: 'Mẫu thất bại.',
        knowledgeItem: { code: 'CHECK_NPP_SELECTION' },
      },
    });
    const { service, prisma, transaction, llm } = createHarness();
    prisma.operatorTask.findUnique.mockResolvedValueOnce(resultTask);
    transaction.operatorTask.findUnique.mockResolvedValueOnce(resultTask);
    const events: string[] = [];
    prisma.$transaction.mockImplementation(async (callback) => {
      events.push('transaction');
      return callback(transaction);
    });
    llm.generateStructured.mockImplementation(async () => {
      events.push('llm');
      return { draftResponse: 'Đã hướng dẫn chọn lại NPP Hải Phòng.' };
    });

    await expect(service.generateResponse('task-1')).resolves.toMatchObject({ id: 'response-1' });

    expect(events).toEqual(['llm', 'transaction']);
    expect(llm.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('Đã hướng dẫn chọn lại NPP Hải Phòng.'),
      }),
    );
    expect(llm.generateStructured.mock.calls[0][0].userPrompt).toContain('Mẫu thành công.');
    expect(transaction.operatorTaskResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ aiGeneratedText: 'Đã hướng dẫn chọn lại NPP Hải Phòng.' }) }),
    );
  });

  it('rejects LLM fields that try to control server-owned task state', async () => {
    const resultTask = task({
      status: OperatorTaskStatus.IN_PROGRESS,
      resultSummary: 'Kết quả do operator nhập.',
      resultData: { outcome: 'SUCCESS' },
      knowledgeItemVersion: { title: 'KB', knowledgeContent: 'Nội dung', knowledgeItem: { code: 'KB_CODE' } },
    });
    const { service, prisma, transaction, llm } = createHarness();
    prisma.operatorTask.findUnique.mockResolvedValue(resultTask);
    llm.generateStructured.mockResolvedValue({ draftResponse: 'Nội dung', status: 'COMPLETED', outcome: 'FAILURE' });

    await expect(service.generateResponse('task-1')).rejects.toThrow('LLM returned an invalid response draft');
    expect(transaction.operatorTaskResponse.create).not.toHaveBeenCalled();
    expect(transaction.operatorTask.update).not.toHaveBeenCalled();
  });

  it('persists a human-edited draft without calling the LLM', async () => {
    const { service, transaction, llm } = createHarness();
    transaction.operatorTask.findUnique.mockResolvedValue(task({ status: OperatorTaskStatus.IN_PROGRESS, currentAssigneeId: 'operator-1' }));

    await expect(service.editDraft('task-1', 'Bản chỉnh sửa của operator.')).resolves.toMatchObject({ id: 'response-1' });

    expect(transaction.operatorTaskResponse.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { finalText: 'Bản chỉnh sửa của operator.', status: TaskResponseStatus.EDITED } }),
    );
    expect(llm.generateStructured).not.toHaveBeenCalled();
    expect(() => normalizeDraftResponse({ draftResponse: ' ' })).toThrow('draftResponse must not be empty');
  });

  it('approves once by atomically creating an outbound operator message and completing the task', async () => {
    const { service, transaction } = createHarness();
    transaction.operatorTask.findUnique.mockResolvedValue(task({ status: OperatorTaskStatus.IN_PROGRESS }));
    transaction.operatorTaskResponse.findFirst.mockResolvedValue({
      id: 'response-1',
      aiGeneratedText: 'Bản nháp AI.',
      finalText: 'Bản được duyệt.',
      status: TaskResponseStatus.EDITED,
    });

    await expect(service.approve('task-1', 'operator-1')).resolves.toEqual({
      taskId: 'task-1',
      status: OperatorTaskStatus.COMPLETED,
      outboundMessageId: 'message-1',
    });

    expect(transaction.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ senderType: MessageSenderType.OPERATOR, direction: MessageDirection.OUTBOUND, content: 'Bản được duyệt.' }),
      }),
    );
    expect(transaction.operatorTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1', status: OperatorTaskStatus.IN_PROGRESS } }),
    );
  });

  it('rejects duplicate or failed approvals without a second committed completion', async () => {
    const { service, transaction } = createHarness();
    transaction.operatorTask.findUnique.mockResolvedValue(task({ status: OperatorTaskStatus.COMPLETED }));

    await expect(service.approve('task-1', 'operator-1')).rejects.toThrow('Invalid task transition');
    expect(transaction.message.create).not.toHaveBeenCalled();

    transaction.operatorTask.findUnique.mockResolvedValue(task({ status: OperatorTaskStatus.IN_PROGRESS }));
    transaction.operatorTaskResponse.findFirst.mockResolvedValue({
      id: 'response-1', aiGeneratedText: 'Nháp.', finalText: null, status: TaskResponseStatus.GENERATED,
    });
    transaction.operatorTask.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('task-1', 'operator-1')).rejects.toThrow('already completed or changed');
    expect(transaction.message.create).toHaveBeenCalledTimes(1);
  });

  it('keeps task state intact when the draft provider fails and rejects terminal task mutations', async () => {
    const { service, prisma, transaction, llm } = createHarness();
    prisma.operatorTask.findUnique.mockResolvedValue(task({
      status: OperatorTaskStatus.IN_PROGRESS,
      resultSummary: 'Kết quả.',
      resultData: { outcome: 'SUCCESS' },
      knowledgeItemVersion: { title: 'KB', knowledgeContent: 'Nội dung', knowledgeItem: { code: 'KB' } },
    }));
    llm.generateStructured.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.generateResponse('task-1')).rejects.toThrow('provider unavailable');
    expect(prisma.$transaction).not.toHaveBeenCalled();

    transaction.operatorTask.findUnique.mockResolvedValue(task({ status: OperatorTaskStatus.COMPLETED }));
    await expect(service.submitResult('task-1', { outcome: null, result: 'Không được lưu.' })).rejects.toThrow('Task must be IN_PROGRESS');
  });
});
