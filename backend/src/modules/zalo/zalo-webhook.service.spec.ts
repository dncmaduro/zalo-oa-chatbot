import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ZaloSignatureService } from './zalo-signature.service';
import { ZaloWebhookService } from './zalo-webhook.service';

describe('Zalo webhook signature and inbox', () => {
  const original = { app: process.env.ZALO_APP_ID, secret: process.env.ZALO_OA_SECRET_KEY };
  const body = { event_name: 'user_send_text', timestamp: '1720000000', sender: { id: 'user-1' }, recipient: { id: 'oa-1' }, message: { msg_id: 'msg-1', text: 'Xin chào' } };
  const raw = Buffer.from(JSON.stringify(body));
  const signature = () => createHash('sha256').update(`app-1${raw.toString()}1720000000secret-1`).digest('hex');
  beforeEach(() => { process.env.ZALO_APP_ID = 'app-1'; process.env.ZALO_OA_SECRET_KEY = 'secret-1'; });
  afterAll(() => { process.env.ZALO_APP_ID = original.app; process.env.ZALO_OA_SECRET_KEY = original.secret; });
  const harness = () => {
    const prisma = { zaloWebhookEvent: { create: jest.fn().mockResolvedValue({}) } };
    return { prisma, service: new ZaloWebhookService(prisma as any, new ZaloSignatureService()) };
  };
  it('uses the exact raw body for a valid signed user_send_text event and persists one pending inbox row', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(raw, body, signature())).resolves.toBeUndefined();
    expect(prisma.zaloWebhookEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalEventKey: 'msg-1', status: 'PENDING' }) }));
  });
  it('rejects invalid signatures without a trusted inbox row', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(raw, body, 'forged')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('acknowledges a unique-conflict retry and marks authenticated unsupported events ignored', async () => {
    const { service, prisma } = harness();
    prisma.zaloWebhookEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.accept(raw, body, signature())).resolves.toBeUndefined();
    const unsupported = { ...body, event_name: 'user_send_image' };
    const unsupportedRaw = Buffer.from(JSON.stringify(unsupported));
    const unsupportedSignature = createHash('sha256').update(`app-1${unsupportedRaw.toString()}1720000000secret-1`).digest('hex');
    await service.accept(unsupportedRaw, unsupported, unsupportedSignature);
    expect(prisma.zaloWebhookEvent.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'IGNORED' }) }));
  });
});
