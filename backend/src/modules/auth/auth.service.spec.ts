import { UnauthorizedException } from '@nestjs/common';

import { OperatorStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { AuthService } from './auth.service';
import { hashPassword } from './password-hash';

const operator = (overrides: Record<string, unknown> = {}) => ({
  id: 'operator-1',
  email: 'operator@example.test',
  fullName: 'Operator Test',
  status: OperatorStatus.ACTIVE,
  passwordHash: '',
  role: {
    id: 'role-1',
    code: 'OPERATOR',
    name: 'Operator',
    permissions: [{ permission: { code: 'task.read' } }, { permission: { code: 'task.update' } }],
  },
  ...overrides,
});

const createHarness = () => {
  const prisma = {
    operator: { findUnique: jest.fn() },
    operatorSession: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  };
  return { prisma, service: new AuthService(prisma as unknown as PrismaService) };
};

describe('AuthService', () => {
  it('creates an opaque session for a valid active operator and stores only the token hash', async () => {
    const { prisma, service } = createHarness();
    prisma.operator.findUnique.mockResolvedValue(operator({ passwordHash: await hashPassword('correct-password') }));
    prisma.operatorSession.create.mockResolvedValue({ id: 'session-1' });

    const result = await service.login({ email: 'operator@example.test', password: 'correct-password' });

    expect(result.accessToken).toBeTruthy();
    expect(result.operator).toEqual(expect.objectContaining({ id: 'operator-1', permissions: ['task.read', 'task.update'] }));
    expect(prisma.operatorSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ operatorId: 'operator-1' }) }),
    );
    expect(prisma.operatorSession.create.mock.calls[0][0].data.refreshTokenHash).not.toBe(result.accessToken);
  });

  it.each([
    ['unknown email', null, 'any-password'],
    ['invalid password', operator({ passwordHash: '$2b$12$fciS3ZuP1qnpfBtkNrM1N.7KmIJBdCZbUjoX9s90JOgQrr8hECYBe' }), 'wrong-password'],
    ['inactive operator', operator({ status: OperatorStatus.INACTIVE, passwordHash: '$2b$12$fciS3ZuP1qnpfBtkNrM1N.7KmIJBdCZbUjoX9s90JOgQrr8hECYBe' }), 'any-password'],
  ])('rejects %s with the same safe authentication error', async (_description, foundOperator, password) => {
    const { prisma, service } = createHarness();
    prisma.operator.findUnique.mockResolvedValue(foundOperator);

    await expect(service.login({ email: 'operator@example.test', password })).rejects.toEqual(
      expect.objectContaining({ status: 401, message: 'Invalid email or password' }),
    );
  });

  it('resolves active sessions for /auth/me and rejects invalid, expired, revoked, or inactive session states', async () => {
    const { prisma, service } = createHarness();
    prisma.operatorSession.findFirst.mockResolvedValue({ id: 'session-1', operator: operator() });

    await expect(service.authenticate('raw-token')).resolves.toEqual({
      sessionId: 'session-1',
      operator: expect.objectContaining({ id: 'operator-1' }),
    });

    prisma.operatorSession.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'session-1',
      operator: operator({ status: OperatorStatus.INACTIVE }),
    });
    await expect(service.authenticate('invalid')).rejects.toThrow(UnauthorizedException);
    await expect(service.authenticate('inactive')).rejects.toThrow(UnauthorizedException);
  });

  it('revokes only the current session on logout', async () => {
    const { prisma, service } = createHarness();
    prisma.operatorSession.updateMany.mockResolvedValue({ count: 1 });

    await service.logout('session-1');

    expect(prisma.operatorSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-1', revokedAt: null } }),
    );
  });
});
