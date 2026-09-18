import { ZaloTokenEncryptionError, ZaloTokenEncryptionService } from './zalo-token-encryption.service';

describe('ZaloTokenEncryptionService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('round-trips a token and uses a random IV for every encryption', () => {
    const service = ZaloTokenEncryptionService.forTesting(key);
    const one = service.encrypt('access-token');
    const two = service.encrypt('access-token');
    expect(service.decrypt(one)).toBe('access-token');
    expect(one).not.toBe(two);
    expect(one).toMatch(/^v1:/);
  });

  it('rejects malformed ciphertext and a different encryption key', () => {
    const encrypted = ZaloTokenEncryptionService.forTesting(key).encrypt('access-token');
    expect(() => ZaloTokenEncryptionService.forTesting(key).decrypt('v1:not-valid')).toThrow(ZaloTokenEncryptionError);
    expect(() => ZaloTokenEncryptionService.forTesting(Buffer.alloc(32, 8).toString('base64')).decrypt(encrypted)).toThrow(ZaloTokenEncryptionError);
  });

  it.each([undefined, 'short', Buffer.alloc(31).toString('base64')])('rejects a missing or malformed encryption key', (badKey) => {
    expect(() => ZaloTokenEncryptionService.forTesting(badKey)).toThrow(ZaloTokenEncryptionError);
  });
});
