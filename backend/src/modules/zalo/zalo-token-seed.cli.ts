import 'dotenv/config';

import { PrismaService } from '../../prisma/prisma.service';
import { ZaloTokenEncryptionService } from './zalo-token-encryption.service';

const PRIMARY_CREDENTIAL_KEY = 'primary';

export async function seedZaloTokens(
  prisma: Pick<PrismaService, 'zaloOaTokenCredential'>,
  encryption = new ZaloTokenEncryptionService(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const accessToken = environment.ZALO_OA_ACCESS_TOKEN?.trim();
  const refreshToken = environment.ZALO_OA_REFRESH_TOKEN?.trim();
  if (!accessToken || !refreshToken) {
    throw new Error('ZALO_OA_ACCESS_TOKEN and ZALO_OA_REFRESH_TOKEN are required for one-time bootstrap seeding.');
  }
  const now = new Date();
  await prisma.zaloOaTokenCredential.upsert({
    where: { key: PRIMARY_CREDENTIAL_KEY },
    create: {
      key: PRIMARY_CREDENTIAL_KEY,
      encryptedAccessToken: encryption.encrypt(accessToken),
      encryptedRefreshToken: encryption.encrypt(refreshToken),
      // The lifetime of manually obtained credentials is unknown, so force a safe refresh on first use.
      accessTokenExpiresAt: now,
    },
    update: {
      encryptedAccessToken: encryption.encrypt(accessToken),
      encryptedRefreshToken: encryption.encrypt(refreshToken),
      accessTokenExpiresAt: now,
      lastRefreshedAt: null,
      version: { increment: 1 },
    },
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await seedZaloTokens(prisma);
    console.log('Zalo OA token credentials were encrypted and seeded successfully. Remove the bootstrap token environment variables now.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch(() => {
    // Avoid printing errors from a database driver, which can include query values.
    console.error('Zalo OA token credential seeding failed. Check configuration and database connectivity.');
    process.exitCode = 1;
  });
}
