import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ZaloWebhookEventStatus } from '../../generated/prisma/client';
import { ZaloSignatureService } from './zalo-signature.service';

@Injectable()
export class ZaloWebhookService {
  private readonly logger = new Logger(ZaloWebhookService.name);
  constructor(private readonly prisma: PrismaService, private readonly signatures: ZaloSignatureService) {}

  async accept(rawBody: Buffer, body: unknown, signature: unknown): Promise<void> {
    const record = this.record(body);
    if (!this.signatures.verify(rawBody, record.timestamp, signature)) throw new UnauthorizedException('Invalid Zalo webhook signature.');
    const supported = record.eventName === 'user_send_text' && Boolean(record.messageId && record.userId && record.oaId && record.text);
    const externalEventKey = record.messageId || `${record.eventName}:${createHash('sha256').update(rawBody).digest('hex')}`;
    try {
      await this.prisma.zaloWebhookEvent.create({ data: {
        externalEventKey, eventName: record.eventName, externalMessageId: record.messageId || null,
        externalUserId: record.userId || null, oaId: record.oaId || null, payload: body as object,
        status: supported ? ZaloWebhookEventStatus.PENDING : ZaloWebhookEventStatus.IGNORED,
      } });
      this.logger.log(JSON.stringify({ event: 'zalo_webhook_received', eventName: record.eventName, externalMessageId: record.messageId || null }));
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      this.logger.log(JSON.stringify({ event: 'zalo_webhook_duplicate', eventName: record.eventName, externalMessageId: record.messageId || null }));
    }
  }

  private record(value: unknown) {
    const body = value && typeof value === 'object' ? value as Record<string, any> : {};
    const message = body.message && typeof body.message === 'object' ? body.message : {};
    return { eventName: typeof body.event_name === 'string' ? body.event_name : 'unknown', timestamp: body.timestamp,
      messageId: typeof message.msg_id === 'string' ? message.msg_id : '', text: typeof message.text === 'string' && message.text.trim().length <= 4000 ? message.text.trim() : '',
      userId: typeof body.sender?.id === 'string' ? body.sender.id : '', oaId: typeof body.recipient?.id === 'string' ? body.recipient.id : '' };
  }
}
