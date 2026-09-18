import { Injectable } from '@nestjs/common';
import { ZaloPermanentError, ZaloRetryableError } from './zalo-errors';
import { ZaloTokenService } from './zalo-token.service';
import { ZaloDeliveryResult } from './zalo.types';

type SendResponse = { error?: number; data?: { message_id?: string } };

@Injectable()
export class ZaloOaClientService {
  private readonly endpoint = 'https://openapi.zalo.me/v3.0/oa/message/cs';

  constructor(private readonly tokens: ZaloTokenService) {}

  async sendText(recipientId: string, text: string): Promise<ZaloDeliveryResult> {
    const firstToken = await this.tokens.getValidAccessToken();
    const first = await this.sendAttempt(recipientId, text, firstToken);
    if (!this.isAuthenticationError(first.body)) return this.resultOrThrow(first);

    const refreshedToken = await this.tokens.refreshAfterAuthFailure(firstToken);
    const second = await this.sendAttempt(recipientId, text, refreshedToken);
    // Deliberately do not refresh a second time. A rotated token that is rejected is permanent.
    return this.resultOrThrow(second);
  }

  private async sendAttempt(recipientId: string, text: string, accessToken: string): Promise<{ response: Response; body: SendResponse }> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: accessToken },
        body: JSON.stringify({ recipient: { user_id: recipientId }, message: { text } }),
      });
    } catch {
      throw new ZaloRetryableError('Zalo transport failure.');
    }
    const body = await response.json().catch(() => ({})) as SendResponse;
    if (response.status >= 500 || response.status === 429) throw new ZaloRetryableError(`Zalo HTTP ${response.status}.`);
    return { response, body };
  }

  private resultOrThrow(result: { response: Response; body: SendResponse }): ZaloDeliveryResult {
    const { response, body } = result;
    // Do not surface arbitrary upstream response text; it could contain sensitive values.
    if (!response.ok || body.error !== 0) throw new ZaloPermanentError(`Zalo API error ${body.error ?? response.status}.`);
    return { externalMessageId: body.data?.message_id ?? null };
  }

  private isAuthenticationError(body: SendResponse): boolean {
    return body.error === -216 || body.error === -220;
  }
}
export { ZaloPermanentError, ZaloRetryableError } from './zalo-errors';
