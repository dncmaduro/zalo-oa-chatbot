import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import {
  ChatChannel,
  HumanContactStatus,
  MessageDirection,
  MessageSenderType,
  OperatorStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedOperator } from '../auth/auth.types';

import { normalizeHumanContactNote, normalizeHumanContactReply } from './dto/human-contact.dto';
import { HumanContactWorkflowService } from './human-contact-workflow.service';

const actor: AuthenticatedOperator = {
  id: 'operator-1', email: 'leader@example.test', fullName: 'Leader', status: OperatorStatus.ACTIVE,
  role: { id: 'role-1', code: 'LEADER', name: 'Leader' }, permissions: ['contact.read', 'contact.assign', 'contact.update'],
};
const assignedOperator: AuthenticatedOperator = { ...actor, id: 'operator-2', permissions: ['contact.read', 'contact.update'] };
const unrelatedOperator: AuthenticatedOperator = { ...assignedOperator, id: 'operator-3' };

const request = (overrides: Record<string, unknown> = {}) => ({
  id: 'contact-1',
  conversationId: 'conversation-1',
  status: HumanContactStatus.PENDING,
  priority: 'NORMAL',
  currentAssigneeId: null,
  fullName: null,
  phoneNumber: null,
  reason: 'Cần nhân viên hỗ trợ.',
  context: null,
  createdAt: new Date('2026-09-05T00:00:00.000Z'),
  assignedAt: null,
  contactedAt: null,
  resolvedAt: null,
  ...overrides,
});

const listConversation = {
  id: 'conversation-1',
  chatUser: { channel: ChatChannel.MOCK, externalUserId: 'dev-user-1' },
  messages: [{ id: 'user-message-1', content: 'Cần hỗ trợ.', createdAt: new Date() }],
};

const createHarness = () => {
  const transaction = {
    humanContactRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(request()),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...request(), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    operator: { findUnique: jest.fn().mockResolvedValue({ id: 'operator-2', status: OperatorStatus.ACTIVE }) },
    humanContactAssignment: { create: jest.fn().mockResolvedValue({ id: 'assignment-1' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    humanContactEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ id: 'conversation-1', chatUser: { channel: ChatChannel.MOCK } }),
      update: jest.fn().mockResolvedValue({}),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'outbound-1' }) },
  };
  const prisma = { ...transaction, $transaction: jest.fn((callback) => callback(transaction)) };
  return { prisma, transaction, service: new HumanContactWorkflowService(prisma as unknown as PrismaService) };
};

describe('HumanContactWorkflowService', () => {
  it('limits normal operators to their assigned queue while contact.assign sees the broad queue', async () => {
    const { service, prisma } = createHarness();
    prisma.humanContactRequest.findMany.mockResolvedValue([{ ...request(), conversation: listConversation, currentAssignee: null }]);

    await service.list({}, actor);
    expect(prisma.humanContactRequest.findMany.mock.calls[0][0].where).not.toHaveProperty('currentAssigneeId');

    await service.list({}, assignedOperator);
    expect(prisma.humanContactRequest.findMany.mock.calls[1][0].where).toMatchObject({ currentAssigneeId: 'operator-2' });
  });

  it('allows detail for the assignee and rejects unrelated normal operators', async () => {
    const { service, prisma } = createHarness();
    const detailRequest = {
      ...request({ currentAssigneeId: 'operator-2' }),
      currentAssignee: { id: 'operator-2', fullName: 'Assigned', email: 'assigned@example.test' },
      conversation: {
        ...listConversation,
        messages: [{ id: 'user-message-1', senderType: MessageSenderType.USER, direction: MessageDirection.INBOUND, content: 'Cần hỗ trợ.', createdAt: new Date() }],
      },
      assignments: [], events: [],
    };
    prisma.humanContactRequest.findUnique.mockResolvedValue(detailRequest);

    await expect(service.detail('contact-1', assignedOperator)).resolves.toMatchObject({ id: 'contact-1' });
    await expect(service.detail('contact-1', unrelatedOperator)).rejects.toThrow(ForbiddenException);
  });

  it('assigns an active operator and records the authenticated actor in history and events', async () => {
    const { service, transaction } = createHarness();

    await expect(service.assign('contact-1', 'operator-2', actor)).resolves.toMatchObject({ status: HumanContactStatus.ASSIGNED });

    expect(transaction.humanContactAssignment.create).toHaveBeenCalledWith({
      data: { requestId: 'contact-1', operatorId: 'operator-2', assignedByOperatorId: 'operator-1' },
    });
    expect(transaction.humanContactEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ASSIGNED', operatorId: 'operator-1' }) }),
    );
  });

  it('ends the prior assignment on reassignment and rejects missing/inactive targets', async () => {
    const { service, transaction } = createHarness();
    transaction.humanContactRequest.findUnique.mockResolvedValue(request({ status: HumanContactStatus.ASSIGNED, currentAssigneeId: 'operator-old' }));

    await service.assign('contact-1', 'operator-2', actor);
    expect(transaction.humanContactAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestId: 'contact-1', operatorId: 'operator-old', endedAt: null } }),
    );

    transaction.operator.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'operator-2', status: OperatorStatus.INACTIVE });
    await expect(service.assign('contact-1', 'missing', actor)).rejects.toThrow('Operator was not found');
    await expect(service.assign('contact-1', 'inactive', actor)).rejects.toThrow('Operator is not active');
  });

  it('starts an assigned request for its assignee and rejects unrelated operators', async () => {
    const { service, transaction } = createHarness();
    transaction.humanContactRequest.findUnique.mockResolvedValue(request({ status: HumanContactStatus.ASSIGNED, currentAssigneeId: 'operator-2' }));

    await expect(service.start('contact-1', assignedOperator)).resolves.toMatchObject({ status: HumanContactStatus.CONTACTED });
    expect(transaction.humanContactEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'STARTED', operatorId: 'operator-2' }) }),
    );
    await expect(service.start('contact-1', unrelatedOperator)).rejects.toThrow(ForbiddenException);
  });

  it('persists internal notes as events only and validates note content', async () => {
    const { service, transaction } = createHarness();
    transaction.humanContactRequest.findUnique.mockResolvedValue(request({ status: HumanContactStatus.CONTACTED, currentAssigneeId: 'operator-2' }));

    await service.addNote('contact-1', 'Đã gọi khách nhưng chưa liên hệ được.', assignedOperator);
    expect(transaction.humanContactEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'NOTE_ADDED', note: 'Đã gọi khách nhưng chưa liên hệ được.' }) }),
    );
    expect(transaction.message.create).not.toHaveBeenCalled();
    expect(() => normalizeHumanContactNote(undefined)).toThrow(BadRequestException);
    expect(() => normalizeHumanContactNote({ note: '   ' })).toThrow(BadRequestException);
  });

  it('persists an exact operator reply and does not close the request', async () => {
    const { service, transaction } = createHarness();
    transaction.humanContactRequest.findUnique.mockResolvedValue(request({ status: HumanContactStatus.CONTACTED, currentAssigneeId: 'operator-2' }));
    const reply = 'Anh/chị vui lòng cung cấp thêm ảnh màn hình để bên em kiểm tra nhé.';

    await expect(service.reply('contact-1', reply, assignedOperator)).resolves.toEqual({ requestId: 'contact-1', outboundMessageId: 'outbound-1' });
    expect(transaction.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ senderType: MessageSenderType.OPERATOR, direction: MessageDirection.OUTBOUND, content: reply }) }),
    );
    expect(transaction.humanContactRequest.updateMany).not.toHaveBeenCalled();
    expect(() => normalizeHumanContactReply({ message: ' ' })).toThrow(BadRequestException);
  });

  it('rejects an unauthorized reply and atomically resolves only once', async () => {
    const { service, transaction } = createHarness();
    transaction.humanContactRequest.findUnique.mockResolvedValue(request({ status: HumanContactStatus.CONTACTED, currentAssigneeId: 'operator-2' }));
    await expect(service.reply('contact-1', 'Không được gửi.', unrelatedOperator)).rejects.toThrow(ForbiddenException);
    expect(transaction.message.create).not.toHaveBeenCalled();

    await expect(service.close('contact-1', assignedOperator)).resolves.toEqual({ requestId: 'contact-1', status: HumanContactStatus.RESOLVED });
    expect(transaction.humanContactRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'contact-1', status: HumanContactStatus.CONTACTED } }),
    );

    transaction.humanContactRequest.findUnique.mockResolvedValue(request({ status: HumanContactStatus.RESOLVED, currentAssigneeId: 'operator-2' }));
    await expect(service.close('contact-1', assignedOperator)).rejects.toThrow(ConflictException);
    await expect(service.reply('contact-1', 'Không được gửi.', assignedOperator)).rejects.toThrow(ConflictException);
  });
});
