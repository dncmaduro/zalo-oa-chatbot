import { ConflictException, InternalServerErrorException } from '@nestjs/common';

import { ChatChannel, OperatorTaskStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

import { TaskFieldCollectionService } from './task-field-collection.service';

const fieldTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-a',
  conversationId: 'conversation-1',
  taskType: 'CHECK_NPP_SELECTION',
  description: 'Kiểm tra NPP được chọn.',
  status: OperatorTaskStatus.PENDING,
  resultSummary: null,
  inputData: { requiredFields: ['Tên tài khoản', 'Tên NPP'], collectedFields: {}, missingFields: ['Tên tài khoản', 'Tên NPP'] },
  knowledgeItemVersion: {
    title: 'Kiểm tra NPP',
    acknowledgementMessage: 'Đã nhận đủ thông tin, bên em sẽ kiểm tra.',
    knowledgeItem: { code: 'CHECK_NPP_SELECTION' },
  },
  ...overrides,
});

const params = { conversationId: 'conversation-1', inboundMessageId: 'inbound-1', channel: ChatChannel.MOCK, message: 'Tài khoản nguyenvana' };
const originalPerformanceLogging = process.env.LLM_PERF_LOG;

const createHarness = (tasks: any[] = [fieldTask()]) => {
  const transaction = {
    operatorTask: {
      findUnique: jest.fn().mockResolvedValue(tasks[0] ?? null),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'task-a', status: OperatorTaskStatus.PENDING, ...data })),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'outbound-1', createdAt: new Date('2026-09-05T00:00:00.000Z') }) },
    operatorTaskEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
    conversation: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    operatorTask: { findMany: jest.fn().mockResolvedValue(tasks) },
    $transaction: jest.fn((callback) => callback(transaction)),
  };
  const llm = { generateStructured: jest.fn().mockResolvedValue({ selectedTaskId: 'task-a', collectedFields: { 'Tên tài khoản': 'nguyenvana' } }) };
  return {
    prisma,
    transaction,
    llm,
    service: new TaskFieldCollectionService(prisma as unknown as PrismaService, llm as unknown as LlmService),
  };
};

describe('TaskFieldCollectionService', () => {
  beforeEach(() => {
    process.env.LLM_PERF_LOG = 'false';
  });

  afterAll(() => {
    if (originalPerformanceLogging === undefined) delete process.env.LLM_PERF_LOG;
    else process.env.LLM_PERF_LOG = originalPerformanceLogging;
  });

  it('does not call the continuation LLM when no eligible task exists', async () => {
    const { service, llm } = createHarness([]);

    await expect(service.tryContinue(params)).resolves.toBeNull();
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  it('merges one supplied field into the same task and asks only for the remaining field', async () => {
    const { service, transaction, llm } = createHarness();

    await expect(service.tryContinue(params)).resolves.toMatchObject({
      operatorTask: { id: 'task-a', status: OperatorTaskStatus.PENDING },
      collectedFields: { 'Tên tài khoản': 'nguyenvana' },
      missingFields: ['Tên NPP'],
      response: 'Anh/chị cho em xin thêm Tên NPP để em kiểm tra nhé.',
      isContinuation: true,
    });
    expect(transaction.operatorTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-a' },
        data: expect.objectContaining({ inputData: expect.objectContaining({ missingFields: ['Tên NPP'] }) }),
      }),
    );
    expect(transaction.operatorTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'FIELDS_UPDATED', data: { fieldNames: ['Tên tài khoản'] } }) }),
    );
    expect(llm.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 96,
        metadata: { purpose: 'task_continuation', correlationId: 'conversation-1:inbound-1' },
      }),
    );
  });

  it('collects an explicitly labelled missing NPP when the LLM omits it', async () => {
    const existing = fieldTask({ inputData: { requiredFields: ['Tên tài khoản', 'Tên NPP'], collectedFields: { 'Tên tài khoản': 'nguyenvana' }, missingFields: ['Tên NPP'] } });
    const { service, llm } = createHarness([existing]);
    llm.generateStructured.mockResolvedValue({ selectedTaskId: null, collectedFields: {} });

    await expect(service.tryContinue({ ...params, message: 'NPP Hải Phòng' })).resolves.toMatchObject({
      collectedFields: { 'Tên tài khoản': 'nguyenvana', 'Tên NPP': 'Hải Phòng' },
      missingFields: [],
      response: 'Đã nhận đủ thông tin, bên em sẽ kiểm tra.',
    });
  });

  it('allows explicit correction of a previously collected field', async () => {
    const existing = fieldTask({ inputData: { requiredFields: ['Tên NPP', 'Tên tài khoản'], collectedFields: { 'Tên NPP': 'Hà Nội' }, missingFields: ['Tên tài khoản'] } });
    const { service, llm } = createHarness([existing]);
    llm.generateStructured.mockResolvedValue({ selectedTaskId: null, collectedFields: {} });

    await expect(service.tryContinue({ ...params, message: 'À NPP của anh là Hải Phòng nhé, tài khoản nguyenvana' })).resolves.toMatchObject({
      collectedFields: { 'Tên NPP': 'Hải Phòng', 'Tên tài khoản': 'nguyenvana' },
      missingFields: [],
    });
  });

  it('uses a uniquely explicit field match even when the LLM returns null', async () => {
    const { service, llm, transaction } = createHarness();
    llm.generateStructured.mockResolvedValue({ selectedTaskId: null, collectedFields: {} });

    await expect(service.tryContinue({ ...params, message: 'NPP Hà Nội' })).resolves.toMatchObject({
      operatorTask: { id: 'task-a' },
      collectedFields: { 'Tên NPP': 'Hà Nội' },
      missingFields: ['Tên tài khoản'],
      isContinuation: true,
    });
    expect(transaction.operatorTask.update).toHaveBeenCalledTimes(1);
  });

  it('uses valid null selection to leave existing tasks untouched for normal resolution', async () => {
    const { service, llm, prisma } = createHarness();
    llm.generateStructured.mockResolvedValue({ selectedTaskId: null, collectedFields: {} });

    await expect(service.tryContinue({ ...params, message: 'Cách tạo đơn sale in thế nào?' })).resolves.toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('selects only the requested task when multiple active tasks are eligible', async () => {
    const taskB = fieldTask({
      id: 'task-b', taskType: 'CHECK_ORDER',
      inputData: { requiredFields: ['Số đơn hàng'], collectedFields: {}, missingFields: ['Số đơn hàng'] },
    });
    const { service, llm, transaction } = createHarness([fieldTask(), taskB]);
    llm.generateStructured.mockResolvedValue({ selectedTaskId: 'task-a', collectedFields: { 'Tên NPP': 'Hải Phòng' } });

    await service.tryContinue({ ...params, message: 'NPP Hải Phòng' });
    expect(transaction.operatorTask.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-a' } }));
  });

  it('does not deterministically choose when multiple eligible tasks share an explicit alias', async () => {
    const taskB = fieldTask({
      id: 'task-b',
      inputData: { requiredFields: ['Tên NPP'], collectedFields: {}, missingFields: ['Tên NPP'] },
    });
    const { service, llm, prisma } = createHarness([fieldTask(), taskB]);
    llm.generateStructured.mockResolvedValue({ selectedTaskId: null, collectedFields: {} });

    await expect(service.tryContinue({ ...params, message: 'NPP Hải Phòng' })).resolves.toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invented task IDs, discards invented fields, and excludes standalone name pronouns', async () => {
    const { service, llm, transaction } = createHarness();
    llm.generateStructured.mockResolvedValueOnce({ selectedTaskId: 'invented-task', collectedFields: {} });
    await expect(service.tryContinue(params)).rejects.toThrow(InternalServerErrorException);
    expect(transaction.operatorTask.update).not.toHaveBeenCalled();

    llm.generateStructured.mockResolvedValueOnce({ selectedTaskId: 'task-a', collectedFields: { Invented: 'value' } });
    await expect(service.tryContinue({ ...params, message: 'Thông tin của tôi là nguyenvana' })).resolves.toMatchObject({
      collectedFields: {}, missingFields: ['Tên tài khoản', 'Tên NPP'],
    });

    const nameTask = fieldTask({ id: 'task-name', inputData: { requiredFields: ['Họ tên'], collectedFields: {}, missingFields: ['Họ tên'] } });
    const nameHarness = createHarness([nameTask]);
    nameHarness.llm.generateStructured.mockResolvedValue({ selectedTaskId: 'task-name', collectedFields: { 'Họ tên': 'Em' } });
    await expect(nameHarness.service.tryContinue({ ...params, message: 'Em mới vào công ty' })).resolves.toMatchObject({ collectedFields: {} });
  });

  it('excludes terminal/result-submitted tasks and fails rather than falling through on provider error', async () => {
    const terminal = fieldTask({ status: OperatorTaskStatus.COMPLETED });
    const finalized = fieldTask({ id: 'task-result', resultSummary: 'Đã xử lý' });
    const noEligible = createHarness([terminal, finalized]);
    await expect(noEligible.service.tryContinue(params)).resolves.toBeNull();
    expect(noEligible.llm.generateStructured).not.toHaveBeenCalled();

    const providerFailure = createHarness();
    providerFailure.llm.generateStructured.mockRejectedValue(new Error('provider unavailable'));
    await expect(providerFailure.service.tryContinue(params)).rejects.toThrow('provider unavailable');
    expect(providerFailure.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps LLM work outside the persistence transaction and rejects stale selected tasks', async () => {
    const { service, llm, prisma, transaction } = createHarness();
    const events: string[] = [];
    llm.generateStructured.mockImplementation(async () => {
      events.push('llm');
      return { selectedTaskId: 'task-a', collectedFields: {} };
    });
    prisma.$transaction.mockImplementation(async (callback) => {
      events.push('transaction');
      return callback(transaction);
    });
    await service.tryContinue(params);
    expect(events).toEqual(['llm', 'transaction']);

    transaction.operatorTask.findUnique.mockResolvedValue(fieldTask({ status: OperatorTaskStatus.COMPLETED }));
    await expect(service.tryContinue(params)).rejects.toThrow(ConflictException);
    expect(transaction.message.create).toHaveBeenCalledTimes(1);
  });
});
