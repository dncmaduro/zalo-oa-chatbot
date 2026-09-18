import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ZaloPermanentError, ZaloRetryableError, ZaloTokenConfigurationError } from './zalo-errors';
import { ZaloTokenEncryptionService } from './zalo-token-encryption.service';

const PRIMARY_CREDENTIAL_KEY = 'primary';
const REFRESH_WINDOW_MS = 10 * 60 * 1000;
const OAUTH_REFRESH_TIMEOUT_MS = 10 * 1000;
// A stable, private advisory-lock ID for the singleton Zalo OA credential.
const REFRESH_ADVISORY_LOCK_SQL = 'SELECT pg_advisory_xact_lock(73124899510234)';

type Credential = {
  key: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: Date;
};

type RefreshResponse = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };

@Injectable()
export class ZaloTokenService {
  private readonly logger = new Logger(ZaloTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: ZaloTokenEncryptionService,
  ) {}

  async getValidAccessToken(): Promise<string> {
    const credential = await this.prisma.zaloOaTokenCredential.findUnique({ where: { key: PRIMARY_CREDENTIAL_KEY } });
    if (!credential) throw new ZaloTokenConfigurationError('Zalo OA token credential is not configured. Run yarn zalo:tokens:seed.');
    const accessToken = this.decryptAccessToken(credential);
    if (!this.needsRefresh(credential.accessTokenExpiresAt)) return accessToken;
    return this.refreshWithLock('proactive');
  }

  async refreshAfterAuthFailure(failedAccessToken: string): Promise<string> {
    if (!failedAccessToken) throw new ZaloTokenConfigurationError('A failed Zalo access token is required for an authentication refresh.');
    return this.refreshWithLock('authentication_failure', failedAccessToken);
  }

  private async refreshWithLock(reason: 'proactive' | 'authentication_failure', failedAccessToken?: string): Promise<string> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(REFRESH_ADVISORY_LOCK_SQL);
      const credential = await transaction.zaloOaTokenCredential.findUnique({ where: { key: PRIMARY_CREDENTIAL_KEY } });
      if (!credential) throw new ZaloTokenConfigurationError('Zalo OA token credential is not configured. Run yarn zalo:tokens:seed.');
      const currentAccessToken = this.decryptAccessToken(credential);

      // The waiter may have acquired the lock after another replica completed a refresh.
      if (reason === 'proactive' && !this.needsRefresh(credential.accessTokenExpiresAt)) return currentAccessToken;
      if (reason === 'authentication_failure' && currentAccessToken !== failedAccessToken) return currentAccessToken;

      const refreshToken = this.decryptRefreshToken(credential);
      const startedAt = Date.now();
      this.logger.log(JSON.stringify({ event: 'zalo_token_refresh_started', reason }));
      try {
        const refreshed = await this.requestRefresh(refreshToken);
        const expiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000);
        await transaction.zaloOaTokenCredential.update({
          where: { key: PRIMARY_CREDENTIAL_KEY },
          data: {
            encryptedAccessToken: this.encryption.encrypt(refreshed.accessToken),
            encryptedRefreshToken: this.encryption.encrypt(refreshed.refreshToken),
            accessTokenExpiresAt: expiresAt,
            lastRefreshedAt: new Date(),
            version: { increment: 1 },
          },
        });
        this.logger.log(JSON.stringify({ event: 'zalo_token_refresh_succeeded', reason, expiresAt: expiresAt.toISOString(), durationMs: Date.now() - startedAt }));
        return refreshed.accessToken;
      } catch (error) {
        const retryable = error instanceof ZaloRetryableError;
        this.logger.error(JSON.stringify({ event: 'zalo_token_refresh_failed', reason, retryable, durationMs: Date.now() - startedAt }));
        throw error;
      }
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  private async requestRefresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }> {
    const appId = process.env.ZALO_APP_ID?.trim();
    const appSecret = process.env.ZALO_APP_SECRET_KEY?.trim();
    if (!appId) throw new ZaloTokenConfigurationError('ZALO_APP_ID is required to refresh Zalo OA tokens.');
    if (!appSecret) throw new ZaloTokenConfigurationError('ZALO_APP_SECRET_KEY is required to refresh Zalo OA tokens.');

    let response: Response;
    try {
      response = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: appSecret },
        body: new URLSearchParams({ app_id: appId, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
        signal: AbortSignal.timeout(OAUTH_REFRESH_TIMEOUT_MS),
      });
    } catch {
      throw new ZaloRetryableError('Zalo OAuth token refresh transport failure.');
    }
    if (response.status === 429 || response.status >= 500) throw new ZaloRetryableError(`Zalo OAuth HTTP ${response.status}.`);
    if (!response.ok) throw new ZaloPermanentError(`Zalo OAuth token refresh was rejected (HTTP ${response.status}).`);

    const body = await response.json().catch(() => null) as RefreshResponse | null;
    const accessToken = typeof body?.access_token === 'string' ? body.access_token.trim() : '';
    const nextRefreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token.trim() : '';
    const expiresInSeconds = typeof body?.expires_in === 'string' || typeof body?.expires_in === 'number'
      ? Number(body.expires_in) : Number.NaN;
    if (!accessToken || !nextRefreshToken || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new ZaloPermanentError('Zalo OAuth token refresh returned an invalid response.');
    }
    return { accessToken, refreshToken: nextRefreshToken, expiresInSeconds };
  }

  private decryptAccessToken(credential: Credential): string {
    return this.encryption.decrypt(credential.encryptedAccessToken);
  }

  private decryptRefreshToken(credential: Credential): string {
    return this.encryption.decrypt(credential.encryptedRefreshToken);
  }

  private needsRefresh(expiresAt: Date): boolean {
    return expiresAt.getTime() <= Date.now() + REFRESH_WINDOW_MS;
  }

}
