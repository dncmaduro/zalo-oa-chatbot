import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

@Injectable()
export class ZaloSignatureService {
  verify(rawBody: Buffer, timestamp: unknown, signature: unknown, payloadAppId?: unknown): boolean {
    const configuredAppId = process.env.ZALO_APP_ID?.trim();
    const secret = process.env.ZALO_OA_SECRET_KEY?.trim();
    const suppliedSignature = this.normalize(signature);
    if (!configuredAppId || !secret || typeof timestamp !== 'string' || !suppliedSignature) return false;
    const hasPayloadAppId = typeof payloadAppId === 'string' && payloadAppId.trim().length > 0;
    if (payloadAppId != null && typeof payloadAppId !== 'string') return false;
    const appId = hasPayloadAppId ? payloadAppId : configuredAppId;
    if (appId !== configuredAppId) return false;
    const expected = createHash('sha256').update(`${appId}${rawBody.toString('utf8')}${timestamp}${secret}`).digest('hex');
    const supplied = Buffer.from(suppliedSignature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer);
  }

  private normalize(signature: unknown): string | undefined {
    if (typeof signature !== 'string') return undefined;
    const value = signature.trim();
    const digest = /^(?:mac\s*=\s*)?([0-9a-f]{64})$/i.exec(value)?.[1];
    return digest?.toLowerCase();
  }
}
