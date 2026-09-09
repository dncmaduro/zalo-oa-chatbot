import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

@Injectable()
export class ZaloSignatureService {
  verify(rawBody: Buffer, timestamp: unknown, signature: unknown): boolean {
    const appId = process.env.ZALO_APP_ID?.trim();
    const secret = process.env.ZALO_OA_SECRET_KEY?.trim();
    if (!appId || !secret || typeof timestamp !== 'string' || typeof signature !== 'string') return false;
    const expected = createHash('sha256').update(`${appId}${rawBody.toString('utf8')}${timestamp}${secret}`).digest('hex');
    const supplied = Buffer.from(signature.trim(), 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer);
  }
}
