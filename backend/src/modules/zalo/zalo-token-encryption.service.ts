import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class ZaloTokenEncryptionError extends Error {}

/** Encrypts OAuth credentials at rest using AES-256-GCM. */
@Injectable()
export class ZaloTokenEncryptionService {
  private key: Buffer;

  constructor() {
    this.key = ZaloTokenEncryptionService.parseKey(process.env.ZALO_TOKEN_ENCRYPTION_KEY);
  }

  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new ZaloTokenEncryptionError('Zalo token encryption received an empty value.');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
  }

  decrypt(serialized: string): string {
    try {
      const [version, ivValue, tagValue, ciphertextValue, ...extra] = serialized.split(':');
      if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || extra.length > 0) throw new Error('invalid envelope');
      const iv = Buffer.from(ivValue, 'base64');
      const tag = Buffer.from(tagValue, 'base64');
      const ciphertext = Buffer.from(ciphertextValue, 'base64');
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error('invalid envelope');
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new ZaloTokenEncryptionError('Stored Zalo token credential cannot be decrypted. Check ZALO_TOKEN_ENCRYPTION_KEY and credential integrity.');
    }
  }

  static parseKey(value: string | undefined): Buffer {
    const key = value?.trim();
    if (!key) throw new ZaloTokenEncryptionError('ZALO_TOKEN_ENCRYPTION_KEY is required and must encode exactly 32 bytes.');
    const decoded = /^[0-9a-fA-F]{64}$/.test(key)
      ? Buffer.from(key, 'hex')
      : Buffer.from(key, 'base64');
    // Reject loose Buffer.from base64 parsing and require a canonical base64 value.
    const canonicalBase64 = decoded.toString('base64').replace(/=+$/, '');
    if (decoded.length !== 32 || (!/^[0-9a-fA-F]{64}$/.test(key) && canonicalBase64 !== key.replace(/=+$/, ''))) {
      throw new ZaloTokenEncryptionError('ZALO_TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as base64 (or 64 hexadecimal characters).');
    }
    return decoded;
  }

  /** Keeps unit tests independent from process-wide environment state. */
  static forTesting(encryptionKey: string | undefined): ZaloTokenEncryptionService {
    const service = Object.create(ZaloTokenEncryptionService.prototype) as ZaloTokenEncryptionService;
    service.key = ZaloTokenEncryptionService.parseKey(encryptionKey);
    return service;
  }
}
