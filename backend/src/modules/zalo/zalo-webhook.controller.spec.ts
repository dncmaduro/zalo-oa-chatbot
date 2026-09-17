import { ZaloWebhookController } from './zalo-webhook.controller';

describe('ZaloWebhookController', () => {
  it('passes X-ZEvent-Timestamp through to webhook signature verification', async () => {
    const accept = jest.fn().mockResolvedValue(undefined);
    const controller = new ZaloWebhookController({ accept } as any);
    const rawBody = Buffer.from('{}');

    await expect(controller.webhook({ rawBody } as any, {}, 'mac=signature', '1720000001')).resolves.toEqual({ ok: true });
    expect(accept).toHaveBeenCalledWith(rawBody, {}, 'mac=signature', '1720000001');
  });
});
