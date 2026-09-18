import { ZaloTokenEncryptionService } from './zalo-token-encryption.service';
import { ZaloTokenService } from './zalo-token.service';
import { ZaloRetryableError } from './zalo-errors';

describe('ZaloTokenService', () => {
  const originalFetch = global.fetch;
  const originalAppId = process.env.ZALO_APP_ID;
  const originalAppSecret = process.env.ZALO_APP_SECRET_KEY;
  const encryption = ZaloTokenEncryptionService.forTesting(Buffer.alloc(32, 3).toString('base64'));

  const credential = (access = 'old-access', refresh = 'old-refresh', expiresAt = new Date(Date.now() + 60 * 60 * 1000)) => ({
    key: 'primary', encryptedAccessToken: encryption.encrypt(access), encryptedRefreshToken: encryption.encrypt(refresh), accessTokenExpiresAt: expiresAt,
  });

  function setup(row: ReturnType<typeof credential>) {
    const delegate = { findUnique: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}) };
    const transaction = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), zaloOaTokenCredential: delegate };
    const prisma = { zaloOaTokenCredential: delegate, $transaction: jest.fn(async (callback: any) => callback(transaction)) };
    return { prisma, delegate, transaction, service: new ZaloTokenService(prisma as any, encryption) };
  }

  beforeEach(() => {
    process.env.ZALO_APP_ID = 'app-id';
    process.env.ZALO_APP_SECRET_KEY = 'application-secret';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.ZALO_APP_ID = originalAppId;
    process.env.ZALO_APP_SECRET_KEY = originalAppSecret;
    jest.restoreAllMocks();
  });

  it('returns a valid DB credential without refreshing', async () => {
    const { service, prisma } = setup(credential());
    await expect(service.getValidAccessToken()).resolves.toBe('old-access');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refreshes a near-expiry credential with the application secret and persists both rotated tokens', async () => {
    const { service, delegate, transaction } = setup(credential('old-access', 'old-refresh', new Date(Date.now() + 60_000)));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: '90000' }) }) as any;
    const before = Date.now();
    await expect(service.getValidAccessToken()).resolves.toBe('new-access');
    expect(transaction.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));
    expect(global.fetch).toHaveBeenCalledWith('https://oauth.zaloapp.com/v4/oa/access_token', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: 'application-secret' },
      body: 'app_id=app-id&grant_type=refresh_token&refresh_token=old-refresh',
      signal: expect.any(AbortSignal),
    }));
    const update = delegate.update.mock.calls[0][0].data;
    expect(encryption.decrypt(update.encryptedAccessToken)).toBe('new-access');
    expect(encryption.decrypt(update.encryptedRefreshToken)).toBe('new-refresh');
    expect(update.accessTokenExpiresAt.getTime()).toBeGreaterThan(before + 89_999_000);
  });

  it('re-checks expiry under the advisory lock and avoids a second refresh', async () => {
    const initial = credential('old-access', 'old-refresh', new Date(Date.now() + 1_000));
    const updated = credential('other-access', 'other-refresh', new Date(Date.now() + 3_600_000));
    const { service, delegate } = setup(initial);
    delegate.findUnique.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);
    global.fetch = jest.fn();
    await expect(service.getValidAccessToken()).resolves.toBe('other-access');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not refresh after an auth failure when another worker already replaced the access token', async () => {
    const { service, delegate } = setup(credential('new-access'));
    delegate.findUnique.mockResolvedValue(credential('new-access'));
    global.fetch = jest.fn();
    await expect(service.refreshAfterAuthFailure('failed-access')).resolves.toBe('new-access');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid OAuth responses without exposing credential values', async () => {
    const { service } = setup(credential('secret-access', 'secret-refresh', new Date(0)));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'secret-access' }) }) as any;
    await expect(service.getValidAccessToken()).rejects.toThrow('invalid response');
    await service.getValidAccessToken().catch((error: Error) => {
      expect(error.message).not.toContain('secret-access');
      expect(error.message).not.toContain('secret-refresh');
    });
  });

  it('classifies an aborted OAuth refresh as retryable', async () => {
    const { service } = setup(credential('old-access', 'old-refresh', new Date(0)));
    global.fetch = jest.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError')) as any;
    await expect(service.getValidAccessToken()).rejects.toBeInstanceOf(ZaloRetryableError);
  });
});
