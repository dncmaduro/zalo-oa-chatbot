import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChatChannel, KnowledgeAudience, ZaloOutboundDeliveryStatus, ZaloWebhookEventStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatOrchestratorService } from '../chat/chat-orchestrator.service';
import { ZaloOaClientService, ZaloPermanentError } from './zalo-oa-client.service';

const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 300_000;
@Injectable()
export class ZaloWebhookProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZaloWebhookProcessorService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly chat: ChatOrchestratorService, private readonly client: ZaloOaClientService) {}
  onModuleInit() { if (process.env.ZALO_WEBHOOK_PROCESSING_ENABLED?.trim().toLowerCase() !== 'false') this.timer = setInterval(() => void this.drain(), 1_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async drain(): Promise<void> { await this.processPending(); await this.deliverPending(); }

  async processPending(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
    // Do not leave exhausted work looking retryable forever.  This update is
    // intentionally outside the claim transaction: it is a short, idempotent
    // state transition and prevents a stale PROCESSING row from becoming a
    // hot loop after the bounded retry budget is consumed.
    await this.prisma.zaloWebhookEvent.updateMany({
      where: {
        attempts: { gte: MAX_ATTEMPTS },
        status: { in: [ZaloWebhookEventStatus.PENDING, ZaloWebhookEventStatus.PROCESSING] },
      },
      data: { status: ZaloWebhookEventStatus.FAILED },
    });
    const event = await this.prisma.zaloWebhookEvent.findFirst({ where: { attempts: { lt: MAX_ATTEMPTS }, OR: [{ status: ZaloWebhookEventStatus.PENDING }, { status: ZaloWebhookEventStatus.PROCESSING, processingStartedAt: { lt: staleBefore } }] }, orderBy: { receivedAt: 'asc' } });
    if (!event) return;
    const claimed = await this.prisma.zaloWebhookEvent.updateMany({ where: { id: event.id, status: event.status, updatedAt: event.updatedAt }, data: { status: ZaloWebhookEventStatus.PROCESSING, processingStartedAt: new Date(), attempts: { increment: 1 } } });
    if (!claimed.count) return;
    const payload = event.payload as any;
    try {
      const result = await this.chat.handle({ channel: ChatChannel.ZALO, externalUserId: event.externalUserId!, message: payload.message.text, audience: this.audience(), idempotencyKey: event.externalEventKey });
      await this.prisma.$transaction(async (tx) => {
        await tx.zaloOutboundDelivery.upsert({ where: { messageId: result.outboundMessageId }, create: { messageId: result.outboundMessageId, externalRecipientId: event.externalUserId! }, update: {} });
        await tx.zaloWebhookEvent.update({ where: { id: event.id }, data: { status: ZaloWebhookEventStatus.PROCESSED, outboundMessageId: result.outboundMessageId, processedAt: new Date(), lastError: null } });
      });
      this.logger.log(JSON.stringify({ event: 'zalo_webhook_processed', conversationId: result.conversationId, inboundMessageId: result.inboundMessageId, outboundMessageId: result.outboundMessageId }));
    } catch (error) {
      await this.prisma.zaloWebhookEvent.update({ where: { id: event.id }, data: { status: ZaloWebhookEventStatus.FAILED, lastError: this.safeError(error) } });
      this.logger.error(JSON.stringify({ event: 'zalo_webhook_failed', classification: 'application_processing' }));
    }
  }

  async deliverPending(): Promise<void> {
    const delivery = await this.prisma.zaloOutboundDelivery.findFirst({ where: { status: { in: [ZaloOutboundDeliveryStatus.PENDING, ZaloOutboundDeliveryStatus.FAILED] }, attempts: { lt: MAX_ATTEMPTS } }, include: { message: true }, orderBy: { createdAt: 'asc' } });
    if (!delivery || !delivery.message.content) return;
    const claimed = await this.prisma.zaloOutboundDelivery.updateMany({ where: { id: delivery.id, status: { in: [ZaloOutboundDeliveryStatus.PENDING, ZaloOutboundDeliveryStatus.FAILED] } }, data: { status: ZaloOutboundDeliveryStatus.SENDING, attempts: { increment: 1 } } });
    if (!claimed.count) return;
    try {
      const sent = await this.client.sendText(delivery.externalRecipientId, delivery.message.content);
      await this.prisma.zaloOutboundDelivery.update({ where: { id: delivery.id }, data: { status: ZaloOutboundDeliveryStatus.SENT, externalMessageId: sent.externalMessageId, sentAt: new Date(), lastError: null } });
      await this.prisma.message.update({ where: { id: delivery.messageId }, data: { deliveryStatus: 'SENT', externalMessageId: sent.externalMessageId ?? undefined, sentAt: new Date() } });
      this.logger.log(JSON.stringify({ event: 'zalo_send', internalMessageId: delivery.messageId, externalMessageId: sent.externalMessageId, result: 'sent' }));
    } catch (error) {
      const permanent = error instanceof ZaloPermanentError;
      await this.prisma.zaloOutboundDelivery.update({ where: { id: delivery.id }, data: { status: ZaloOutboundDeliveryStatus.FAILED, attempts: permanent ? MAX_ATTEMPTS : undefined, lastError: this.safeError(error) } });
      this.logger.error(JSON.stringify({ event: 'zalo_send', internalMessageId: delivery.messageId, result: permanent ? 'permanent_failure' : 'retryable_failure' }));
    }
  }
  private audience(): KnowledgeAudience { return process.env.ZALO_DEFAULT_AUDIENCE === 'EMPLOYEE' ? KnowledgeAudience.EMPLOYEE : KnowledgeAudience.CUSTOMER; }
  private safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : 'unknown'; }
}
