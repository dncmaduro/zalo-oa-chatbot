import { Injectable } from '@nestjs/common';
import { ZaloDeliveryResult } from './zalo.types';

@Injectable()
export class ZaloOaClientService {
  private readonly endpoint = 'https://openapi.zalo.me/v3.0/oa/message/cs';

  async sendText(recipientId: string, text: string): Promise<ZaloDeliveryResult> {
    const accessToken = process.env.ZALO_OA_ACCESS_TOKEN?.trim();
    if (!accessToken) throw new ZaloPermanentError('Zalo OA access token is not configured.');
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: accessToken },
        body: JSON.stringify({ recipient: { user_id: recipientId }, message: { text } }),
      });
    } catch (error) {
      throw new ZaloRetryableError(error instanceof Error ? error.message : 'Zalo transport failure.');
    }
    if (response.status >= 500 || response.status === 429) throw new ZaloRetryableError(`Zalo HTTP ${response.status}.`);
    const body = await response.json().catch(() => ({})) as { error?: number; message?: string; data?: { message_id?: string } };
    if (!response.ok || body.error !== 0) throw new ZaloPermanentError(`Zalo API error ${body.error ?? response.status}: ${body.message ?? 'unknown'}`);
    return { externalMessageId: body.data?.message_id ?? null };
  }
}
export class ZaloRetryableError extends Error {}
export class ZaloPermanentError extends Error {}
