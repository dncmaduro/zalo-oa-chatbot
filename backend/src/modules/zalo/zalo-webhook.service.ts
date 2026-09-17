import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ZaloWebhookEventStatus } from '../../generated/prisma/client';
import { ZaloSignatureService } from './zalo-signature.service';

@Injectable()
export class ZaloWebhookService {
  private readonly logger = new Logger(ZaloWebhookService.name);
  constructor(private readonly prisma: PrismaService, private readonly signatures: ZaloSignatureService) {}

  async accept(rawBody: Buffer, body: unknown, signature: unknown, headerTimestamp?: unknown): Promise<void> {
    if (this.isVerificationProbe(body, signature)) {
      this.logger.log(JSON.stringify({ event: 'zalo_webhook_verification_probe' }));
      return;
    }
    const record = this.record(body);
    const timestamp = this.timestamp(headerTimestamp, record.timestamp);
    const verification = this.signatures.verifyDetailed(rawBody, timestamp.value, signature, record.appId);
    if (!verification.valid) {
      this.logger.warn(JSON.stringify({
        event: 'zalo_webhook_signature_rejected', reason: verification.reason, eventName: record.eventName,
        rawBodyBytes: rawBody.length, signaturePresent: this.signaturePresent(signature),
        signatureFormat: this.signatures.classifySignatureFormat(signature), timestampSource: timestamp.source,
        payloadAppIdPresent: typeof record.appId === 'string' && record.appId.trim().length > 0,
      }));
      throw new UnauthorizedException('Invalid Zalo webhook signature.');
    }
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

  private isVerificationProbe(value: unknown, signature: unknown): boolean {
    const signatureIsAbsentOrEmpty = signature == null || (typeof signature === 'string' && signature.trim().length === 0);
    const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const hasMeaningfulEventName = typeof body.event_name === 'string' && body.event_name.trim().length > 0;
    return signatureIsAbsentOrEmpty && !hasMeaningfulEventName;
  }

  private timestamp(headerTimestamp: unknown, bodyTimestamp: unknown): { value: unknown; source: 'header' | 'body' | 'missing' } {
    if (typeof headerTimestamp === 'string' && headerTimestamp.trim().length > 0) return { value: headerTimestamp.trim(), source: 'header' };
    if (typeof bodyTimestamp === 'string' && bodyTimestamp.trim().length > 0) return { value: bodyTimestamp, source: 'body' };
    return { value: bodyTimestamp, source: 'missing' };
  }

  private signaturePresent(signature: unknown): boolean {
    return typeof signature === 'string' && signature.trim().length > 0;
  }

  private record(value: unknown) {
    const body = value && typeof value === 'object' ? value as Record<string, any> : {};
    const message = body.message && typeof body.message === 'object' ? body.message : {};
    return { eventName: typeof body.event_name === 'string' ? body.event_name : 'unknown', timestamp: body.timestamp, appId: body.app_id,
      messageId: typeof message.msg_id === 'string' ? message.msg_id : '', text: typeof message.text === 'string' && message.text.trim().length <= 4000 ? message.text.trim() : '',
      userId: typeof body.sender?.id === 'string' ? body.sender.id : '', oaId: typeof body.recipient?.id === 'string' ? body.recipient.id : '' };
  }
}
