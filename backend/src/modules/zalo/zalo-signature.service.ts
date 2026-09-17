import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

export type ZaloSignatureVerificationResult = {
  valid: boolean;
  reason: 'valid' | 'missing_config' | 'invalid_timestamp' | 'invalid_signature_format' | 'invalid_payload_app_id' | 'app_id_mismatch' | 'digest_mismatch';
};

export type ZaloSignatureFormat = 'missing' | 'bare' | 'mac_prefixed' | 'other';

@Injectable()
export class ZaloSignatureService {
  verify(rawBody: Buffer, timestamp: unknown, signature: unknown, payloadAppId?: unknown): boolean {
    return this.verifyDetailed(rawBody, timestamp, signature, payloadAppId).valid;
  }

  verifyDetailed(rawBody: Buffer, timestamp: unknown, signature: unknown, payloadAppId?: unknown): ZaloSignatureVerificationResult {
    const configuredAppId = process.env.ZALO_APP_ID?.trim();
    const secret = process.env.ZALO_OA_SECRET_KEY?.trim();
    const suppliedSignature = this.normalize(signature);
    if (!configuredAppId || !secret) return { valid: false, reason: 'missing_config' };
    if (typeof timestamp !== 'string') return { valid: false, reason: 'invalid_timestamp' };
    if (!suppliedSignature) return { valid: false, reason: 'invalid_signature_format' };
    const hasPayloadAppId = typeof payloadAppId === 'string' && payloadAppId.trim().length > 0;
    if (payloadAppId != null && typeof payloadAppId !== 'string') return { valid: false, reason: 'invalid_payload_app_id' };
    const appId = hasPayloadAppId ? payloadAppId : configuredAppId;
    if (appId !== configuredAppId) return { valid: false, reason: 'app_id_mismatch' };
    const expected = createHash('sha256').update(`${appId}${rawBody.toString('utf8')}${timestamp}${secret}`).digest('hex');
    const supplied = Buffer.from(suppliedSignature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer)
      ? { valid: true, reason: 'valid' }
      : { valid: false, reason: 'digest_mismatch' };
  }

  classifySignatureFormat(signature: unknown): ZaloSignatureFormat {
    if (typeof signature !== 'string' || signature.trim().length === 0) return 'missing';
    const value = signature.trim();
    if (/^mac\s*=/i.test(value)) return 'mac_prefixed';
    if (/^[0-9a-f]+$/i.test(value)) return 'bare';
    return 'other';
  }

  private normalize(signature: unknown): string | undefined {
    if (typeof signature !== 'string') return undefined;
    const value = signature.trim();
    const digest = /^(?:mac\s*=\s*)?([0-9a-f]{64})$/i.exec(value)?.[1];
    return digest?.toLowerCase();
  }
}
