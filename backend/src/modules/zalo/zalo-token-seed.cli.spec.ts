import { ZaloTokenEncryptionService } from './zalo-token-encryption.service';
import { seedZaloTokens } from './zalo-token-seed.cli';

describe('seedZaloTokens', () => {
  const encryption = ZaloTokenEncryptionService.forTesting(Buffer.alloc(32, 5).toString('base64'));

  it('requires both bootstrap values and writes only encrypted values through an upsert', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    await expect(seedZaloTokens({ zaloOaTokenCredential: { upsert } } as any, encryption, {})).rejects.toThrow('ZALO_OA_ACCESS_TOKEN and ZALO_OA_REFRESH_TOKEN');
    await seedZaloTokens({ zaloOaTokenCredential: { upsert } } as any, encryption, {
      ZALO_OA_ACCESS_TOKEN: 'bootstrap-access', ZALO_OA_REFRESH_TOKEN: 'bootstrap-refresh',
    });
    const write = upsert.mock.calls[0][0];
    expect(encryption.decrypt(write.create.encryptedAccessToken)).toBe('bootstrap-access');
    expect(encryption.decrypt(write.create.encryptedRefreshToken)).toBe('bootstrap-refresh');
    expect(write.create.accessTokenExpiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(JSON.stringify(write)).not.toContain('bootstrap-access');
    expect(JSON.stringify(write)).not.toContain('bootstrap-refresh');
  });
});
