import { BadRequestException } from '@nestjs/common';

import {
  ChatChannel,
  HumanContactStatus,
  KnowledgeAudience,
  OperatorTaskStatus,
  ResolutionType,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { ChatController } from './chat.controller';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { ChatResolveResult, ChatResolveService } from './chat-resolve.service';

const baseResolution = (overrides: Partial<ChatResolveResult> = {}): ChatResolveResult => ({
  resolutionType: ResolutionType.AUTO_RESPONSE,
  selectedKnowledge: null,
  response: 'Câu trả lời từ bot.',
  requiredFields: [],
  collectedFields: {},
  missingFields: [],
  operatorTaskType: null,
  operatorInstruction: null,
  supportingKnowledge: [],
  model: 'qwen3:8b',
  ...overrides,
});

const input = {
  externalUserId: 'dev-user-001',
  channel: ChatChannel.MOCK,
  message: 'Anh tạo đơn nhưng không thấy tồn kho',
  audience: KnowledgeAudience.EMPLOYEE,
};

const createHarness = (resolution = baseResolution()) => {
  let messageNumber = 0;
  const transaction = {
    chatUser: {
      upsert: jest.fn().mockResolvedValue({ id: 'user-1' }),
    },
    conversation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    message: {
      create: jest.fn().mockImplementation(({ data }) => {
        messageNumber += 1;
        return Promise.resolve({
          id: data.direction === 'INBOUND' ? `inbound-${messageNumber}` : `outbound-${messageNumber}`,
          createdAt: new Date('2026-09-05T00:00:00.000Z'),
        });
      }),
    },
    conversationResolution: {
      create: jest.fn().mockResolvedValue({ id: 'resolution-1' }),
    },
    operatorTask: {
      create: jest.fn().mockResolvedValue({ id: 'task-1', status: OperatorTaskStatus.PENDING }),
    },
    humanContactRequest: {
      create: jest.fn().mockResolvedValue({ id: 'contact-1', status: HumanContactStatus.PENDING }),
    },
    messageKnowledgeItemRef: {
      create: jest.fn().mockResolvedValue({}),
    },
    messageKnowledgeSectionRef: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn((callback) => callback(transaction)),
    knowledgeItem: { findUnique: jest.fn().mockResolvedValue(null) },
    knowledgeDocument: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const resolver = { resolve: jest.fn().mockResolvedValue(resolution) };
  const service = new ChatOrchestratorService(
    prisma as unknown as PrismaService,
    resolver as unknown as ChatResolveService,
  );

  return { service, prisma, resolver, transaction };
};

describe('ChatOrchestratorService', () => {
  it('creates an active conversation, persists inbound/outbound messages, and returns AUTO_RESPONSE', async () => {
    const { service, transaction, resolver } = createHarness();

    await expect(service.handle(input)).resolves.toMatchObject({
      conversationId: 'conversation-1',
      inboundMessageId: 'inbound-1',
      outboundMessageId: 'outbound-2',
      resolutionType: ResolutionType.AUTO_RESPONSE,
      operatorTask: null,
      humanContactRequest: null,
    });

    expect(transaction.chatUser.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channel_externalUserId: { channel: ChatChannel.MOCK, externalUserId: 'dev-user-001' } },
      }),
    );
    expect(transaction.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(transaction.message.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ content: input.message, direction: 'INBOUND' }) }),
    );
    expect(transaction.message.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ content: 'Câu trả lời từ bot.', direction: 'OUTBOUND' }) }),
    );
    expect(transaction.operatorTask.create).not.toHaveBeenCalled();
    expect(transaction.humanContactRequest.create).not.toHaveBeenCalled();
    expect(resolver.resolve).toHaveBeenCalledWith({ message: input.message, audience: input.audience });
  });

  it('reuses the same active conversation for a later message from the same channel user', async () => {
    const { service, transaction } = createHarness();
    transaction.conversation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'conversation-1' });

    await service.handle(input);
    await service.handle({ ...input, message: 'Tin nhắn thứ hai' });

    expect(transaction.conversation.create).toHaveBeenCalledTimes(1);
    expect(transaction.message.create.mock.calls[2][0].data.conversationId).toBe('conversation-1');
  });

  it('creates exactly one pending operator task with resolved metadata and an acknowledgement', async () => {
    const resolution = baseResolution({
      resolutionType: ResolutionType.OPERATOR_TASK,
      selectedKnowledge: { type: 'KNOWLEDGE_ITEM', knowledgeCode: 'ORDER_STOCK_CHECK' },
      response: 'Đã tiếp nhận yêu cầu, bộ phận phụ trách sẽ kiểm tra.',
      requiredFields: ['Mã đơn hàng'],
      collectedFields: { 'Mã đơn hàng': 'SO-001' },
      missingFields: [],
      operatorTaskType: 'CHECK_ORDER_STOCK',
      operatorInstruction: 'Kiểm tra tồn kho cho đơn hàng.',
    });
    const { service, transaction, prisma } = createHarness(resolution);
    prisma.knowledgeItem.findUnique.mockResolvedValue({ currentPublishedVersion: { id: 'knowledge-version-1' } });

    await expect(service.handle(input)).resolves.toMatchObject({
      operatorTask: { id: 'task-1', status: OperatorTaskStatus.PENDING },
      humanContactRequest: null,
    });

    expect(transaction.operatorTask.create).toHaveBeenCalledTimes(1);
    expect(transaction.operatorTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskType: 'CHECK_ORDER_STOCK',
          description: 'Kiểm tra tồn kho cho đơn hàng.',
          inputData: expect.objectContaining({
            requiredFields: ['Mã đơn hàng'],
            collectedFields: { 'Mã đơn hàng': 'SO-001' },
          }),
        }),
      }),
    );
    expect(transaction.message.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: resolution.response }) }),
    );
    expect(transaction.humanContactRequest.create).not.toHaveBeenCalled();
  });

  it('creates a pending human-contact request and fallback outbound message without an operator task', async () => {
    const resolution = baseResolution({
      resolutionType: ResolutionType.HUMAN_CONTACT,
      response: 'Vui lòng chờ bộ phận hỗ trợ liên hệ.',
    });
    const { service, transaction } = createHarness(resolution);

    await expect(service.handle(input)).resolves.toMatchObject({
      operatorTask: null,
      humanContactRequest: { id: 'contact-1', status: HumanContactStatus.PENDING },
    });

    expect(transaction.humanContactRequest.create).toHaveBeenCalledTimes(1);
    expect(transaction.operatorTask.create).not.toHaveBeenCalled();
    expect(transaction.message.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: resolution.response }) }),
    );
  });

  it('keeps the inbound message but creates no branch records when resolution fails', async () => {
    const { service, transaction, resolver } = createHarness();
    resolver.resolve.mockRejectedValue(new Error('Ollama unavailable'));

    await expect(service.handle(input)).rejects.toThrow('Ollama unavailable');

    expect(transaction.message.create).toHaveBeenCalledTimes(1);
    expect(transaction.conversationResolution.create).not.toHaveBeenCalled();
    expect(transaction.operatorTask.create).not.toHaveBeenCalled();
    expect(transaction.humanContactRequest.create).not.toHaveBeenCalled();
  });

  it('writes the branch records and outbound message inside one short transaction', async () => {
    const resolution = baseResolution({ resolutionType: ResolutionType.OPERATOR_TASK, operatorTaskType: 'CHECK_ORDER' });
    const { service, prisma, transaction } = createHarness(resolution);
    transaction.message.create.mockImplementationOnce(({ data }) =>
      Promise.resolve({ id: 'inbound-1', createdAt: new Date('2026-09-05T00:00:00.000Z') }),
    );
    transaction.message.create.mockRejectedValueOnce(new Error('outbound write failed'));

    await expect(service.handle(input)).rejects.toThrow('outbound write failed');

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.operatorTask.create).toHaveBeenCalledTimes(1);
  });

  it('does not hold a transaction open while ChatResolveService runs', async () => {
    const events: string[] = [];
    const { service, prisma, resolver } = createHarness();
    prisma.$transaction.mockImplementation(async (callback) => {
      events.push('transaction-start');
      const result = await callback(prisma);
      events.push('transaction-end');
      return result;
    });
    resolver.resolve.mockImplementation(async () => {
      events.push('resolve');
      return baseResolution();
    });

    await service.handle(input);

    expect(events).toEqual(['transaction-start', 'transaction-end', 'resolve', 'transaction-start', 'transaction-end']);
  });
});

describe('ChatController message validation', () => {
  const controller = new ChatController(
    { resolve: jest.fn() } as unknown as ChatResolveService,
    { handle: jest.fn() } as unknown as ChatOrchestratorService,
  );

  it('rejects empty messages and invalid channel/audience values before orchestration', () => {
    expect(() => controller.createMessage({ ...input, message: '   ' })).toThrow(BadRequestException);
    expect(() => controller.createMessage({ ...input, channel: 'DEV' as ChatChannel })).toThrow(BadRequestException);
    expect(() => controller.createMessage({ ...input, audience: 'INVALID' as KnowledgeAudience })).toThrow(
      BadRequestException,
    );
  });
});
