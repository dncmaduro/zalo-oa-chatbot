import { ChatChannel, KnowledgeAudience, ZaloWebhookEventStatus } from '../../generated/prisma/client';
import { ZaloWebhookProcessorService } from './zalo-webhook-processor.service';

describe('ZaloWebhookProcessorService recovery', () => {
  const event = {
    id: 'event-1', externalEventKey: 'message-1', externalUserId: 'user-1',
    payload: { message: { text: 'hello' } }, status: ZaloWebhookEventStatus.PROCESSING,
    attempts: 1, updatedAt: new Date('2026-09-12T00:00:00Z'), receivedAt: new Date('2026-09-12T00:00:00Z'),
  };
  const result = { conversationId: 'conversation-1', inboundMessageId: 'inbound-1', outboundMessageId: 'outbound-1' };
  const harness = () => {
    const prisma = {
      zaloWebhookEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue(event), update: jest.fn().mockResolvedValue({}) },
      zaloOutboundDelivery: { upsert: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn) => fn(prisma)),
    };
    const chat = { handle: jest.fn().mockResolvedValue(result) };
    const client = { sendText: jest.fn() };
    return { prisma, chat, service: new ZaloWebhookProcessorService(prisma as any, chat as any, client as any) };
  };

  it('reclaims a stale PROCESSING event, increments attempts, and completes application work once', async () => {
    const { service, prisma, chat } = harness();
    await service.processPending();
    expect(prisma.zaloWebhookEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ status: 'PROCESSING' })]) }) }));
    expect(prisma.zaloWebhookEvent.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING', attempts: { increment: 1 }, processingStartedAt: expect.any(Date) }) }));
    expect(chat.handle).toHaveBeenCalledWith(expect.objectContaining({ channel: ChatChannel.ZALO, externalUserId: 'user-1', message: 'hello', audience: KnowledgeAudience.CUSTOMER, idempotencyKey: 'message-1' }));
    expect(prisma.zaloOutboundDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { messageId: 'outbound-1' } }));
    expect(prisma.zaloWebhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: ZaloWebhookEventStatus.PROCESSED }) }));
  });

  it('marks exhausted pending/processing work FAILED before it can hot-loop', async () => {
    const { service, prisma } = harness();
    prisma.zaloWebhookEvent.findFirst.mockResolvedValue(null);
    await service.processPending();
    expect(prisma.zaloWebhookEvent.updateMany.mock.calls[0][0]).toEqual(expect.objectContaining({ where: expect.objectContaining({ attempts: { gte: 3 }, status: { in: [ZaloWebhookEventStatus.PENDING, ZaloWebhookEventStatus.PROCESSING] } }), data: { status: ZaloWebhookEventStatus.FAILED } }));
  });
});
