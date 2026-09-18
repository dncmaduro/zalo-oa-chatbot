import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ZaloTokenEncryptionService } from './zalo-token-encryption.service';
import { ZaloTokenService } from './zalo-token.service';

describe('Zalo token Nest DI wiring', () => {
  it('resolves the encryption and token services without a primitive constructor dependency', async () => {
    const originalKey = process.env.ZALO_TOKEN_ENCRYPTION_KEY;
    process.env.ZALO_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    try {
      const module = await Test.createTestingModule({
        providers: [
          ZaloTokenEncryptionService,
          ZaloTokenService,
          { provide: PrismaService, useValue: {} },
        ],
      }).compile();
      expect(module.get(ZaloTokenEncryptionService)).toBeInstanceOf(ZaloTokenEncryptionService);
      expect(module.get(ZaloTokenService)).toBeInstanceOf(ZaloTokenService);
      await module.close();
    } finally {
      if (originalKey === undefined) delete process.env.ZALO_TOKEN_ENCRYPTION_KEY;
      else process.env.ZALO_TOKEN_ENCRYPTION_KEY = originalKey;
    }
  });
});
