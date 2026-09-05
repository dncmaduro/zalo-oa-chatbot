import { Injectable, UnauthorizedException } from '@nestjs/common';

import { OperatorStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { AuthenticatedOperator, AuthenticatedRequestContext } from './auth.types';
import { hashSessionToken, createSessionToken } from './session-token';
import { verifyPassword } from './password-hash';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(input: { email: string; password: string }) {
    const operator = await this.prisma.operator.findUnique({
      where: { email: input.email },
      include: this.operatorInclude(),
    });
    if (!operator || operator.status !== OperatorStatus.ACTIVE) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await verifyPassword(input.password, operator.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);

    const accessToken = createSessionToken();
    const expiresAt = this.getSessionExpiry();
    await this.prisma.operatorSession.create({
      data: {
        operatorId: operator.id,
        refreshTokenHash: hashSessionToken(accessToken),
        expiresAt,
      },
    });

    return { accessToken, expiresAt, operator: this.toAuthenticatedOperator(operator) };
  }

  async authenticate(accessToken: string): Promise<AuthenticatedRequestContext> {
    const session = await this.prisma.operatorSession.findFirst({
      where: {
        refreshTokenHash: hashSessionToken(accessToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { operator: { include: this.operatorInclude() } },
    });
    if (!session || session.operator.status !== OperatorStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return { sessionId: session.id, operator: this.toAuthenticatedOperator(session.operator) };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.operatorSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private operatorInclude() {
    return {
      role: {
        include: {
          permissions: { include: { permission: { select: { code: true } } } },
        },
      },
    };
  }

  private toAuthenticatedOperator(operator: any): AuthenticatedOperator {
    return {
      id: operator.id,
      email: operator.email,
      fullName: operator.fullName,
      status: operator.status,
      role: { id: operator.role.id, code: operator.role.code, name: operator.role.name },
      permissions: operator.role.permissions.map((entry: any) => entry.permission.code).sort(),
    };
  }

  private getSessionExpiry(): Date {
    const configuredValue = process.env.AUTH_SESSION_TTL_HOURS?.trim() || '24';
    const ttlHours = Number(configuredValue);
    if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
      throw new Error('AUTH_SESSION_TTL_HOURS must be a positive number');
    }
    return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  }
}
