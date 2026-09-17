import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ZaloSignatureService } from './zalo-signature.service';
import { ZaloWebhookService } from './zalo-webhook.service';

describe('Zalo webhook signature and inbox', () => {
  const original = { app: process.env.ZALO_APP_ID, secret: process.env.ZALO_OA_SECRET_KEY };
  const body = { event_name: 'user_send_text', timestamp: '1720000000', sender: { id: 'user-1' }, recipient: { id: 'oa-1' }, message: { msg_id: 'msg-1', text: 'Xin chào' } };
  const raw = Buffer.from(JSON.stringify(body));
  const signature = (rawBody = raw, timestamp = body.timestamp, appId = 'app-1') => createHash('sha256').update(`${appId}${rawBody.toString()}${timestamp}secret-1`).digest('hex');
  beforeEach(() => { process.env.ZALO_APP_ID = 'app-1'; process.env.ZALO_OA_SECRET_KEY = 'secret-1'; });
  afterAll(() => { process.env.ZALO_APP_ID = original.app; process.env.ZALO_OA_SECRET_KEY = original.secret; });
  const harness = () => {
    const prisma = { zaloWebhookEvent: { create: jest.fn().mockResolvedValue({}) } };
    return { prisma, service: new ZaloWebhookService(prisma as any, new ZaloSignatureService()) };
  };
  it('acknowledges an unsigned empty verification probe without persisting it', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(Buffer.from('{}'), {}, undefined)).resolves.toBeUndefined();
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('acknowledges an unsigned body without event_name as a verification probe without persisting it', async () => {
    const { service, prisma } = harness();
    const probe = { verification: true };
    await expect(service.accept(Buffer.from(JSON.stringify(probe)), probe, '')).resolves.toBeUndefined();
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('accepts a valid bare hexadecimal signature and persists one pending inbox row', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(raw, body, signature())).resolves.toBeUndefined();
    expect(prisma.zaloWebhookEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalEventKey: 'msg-1', status: 'PENDING' }) }));
  });
  it('accepts a valid mac-prefixed hexadecimal signature', async () => {
    const { service } = harness();
    await expect(service.accept(raw, body, `mac=${signature()}`)).resolves.toBeUndefined();
  });
  it('accepts a valid uppercase MAC-prefixed hexadecimal signature', async () => {
    const { service } = harness();
    await expect(service.accept(raw, body, `MAC=${signature()}`)).resolves.toBeUndefined();
  });
  it('accepts a mac prefix with whitespace around its equals sign', async () => {
    const { service } = harness();
    await expect(service.accept(raw, body, `mac = ${signature()}`)).resolves.toBeUndefined();
  });
  it('accepts surrounding whitespace around a spaced mac-prefixed signature', async () => {
    const { service } = harness();
    await expect(service.accept(raw, body, `  mac = ${signature()}  `)).resolves.toBeUndefined();
  });
  it('rejects a signature with a malformed prefix', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(raw, body, `sha256=${signature()}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('rejects a well-formed but wrong digest', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(raw, body, `mac=${'0'.repeat(64)}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('rejects a malformed digest', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(raw, body, `mac=${signature().slice(1)}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('uses X-ZEvent-Timestamp when it is present', async () => {
    const { service } = harness();
    const headerTimestamp = '1720000001';
    await expect(service.accept(raw, body, signature(raw, headerTimestamp), headerTimestamp)).resolves.toBeUndefined();
  });
  it('falls back to body.timestamp when X-ZEvent-Timestamp is absent', async () => {
    const { service } = harness();
    await expect(service.accept(raw, body, signature())).resolves.toBeUndefined();
  });
  it('accepts a matching payload app_id', async () => {
    const { service } = harness();
    const withAppId = { ...body, app_id: 'app-1' };
    const withAppIdRaw = Buffer.from(JSON.stringify(withAppId));
    await expect(service.accept(withAppIdRaw, withAppId, signature(withAppIdRaw))).resolves.toBeUndefined();
  });
  it('rejects a payload app_id that differs from the configured app ID', async () => {
    const { service, prisma } = harness();
    const withWrongAppId = { ...body, app_id: 'app-2' };
    const withWrongAppIdRaw = Buffer.from(JSON.stringify(withWrongAppId));
    await expect(service.accept(withWrongAppIdRaw, withWrongAppId, signature(withWrongAppIdRaw))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('uses the exact raw request body for digest generation', async () => {
    const { service } = harness();
    const formattedRaw = Buffer.from(` {\n  ${JSON.stringify(body).slice(1, -1)}\n}`);
    await expect(service.accept(formattedRaw, body, signature(formattedRaw))).resolves.toBeUndefined();
  });
  it('rejects an unsigned body containing a Zalo event_name without a trusted inbox row', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(raw, body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('rejects invalid signatures without a trusted inbox row', async () => {
    const { service, prisma } = harness();
    await expect(service.accept(raw, body, 'forged')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.zaloWebhookEvent.create).not.toHaveBeenCalled();
  });
  it('logs one safe diagnostic before rejecting an invalid real event signature', async () => {
    const { service } = harness();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      await expect(service.accept(raw, body, `mac=${'0'.repeat(64)}`)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
        event: 'zalo_webhook_signature_rejected', reason: 'digest_mismatch', eventName: 'user_send_text',
        rawBodyBytes: raw.length, signaturePresent: true, signatureFormat: 'mac_prefixed',
        timestampSource: 'body', payloadAppIdPresent: false,
      });
    } finally {
      warn.mockRestore();
    }
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
