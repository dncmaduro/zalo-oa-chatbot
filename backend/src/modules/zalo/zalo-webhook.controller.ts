import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ZaloWebhookService } from './zalo-webhook.service';

@Controller('integrations/zalo')
export class ZaloWebhookController {
  constructor(private readonly webhooks: ZaloWebhookService) {}
  @Post('webhook') @HttpCode(200)
  async webhook(@Req() request: Request & { rawBody?: Buffer }, @Body() body: unknown, @Headers('x-zevent-signature') signature?: string, @Headers('x-zevent-timestamp') timestamp?: string) {
    await this.webhooks.accept(request.rawBody ?? Buffer.from(''), body, signature, timestamp);
    return { ok: true };
  }
}
