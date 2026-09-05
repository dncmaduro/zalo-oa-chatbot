import { ConflictException } from '@nestjs/common';

import { OperatorStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { OperatorManagementService } from './operator-management.service';

const role = { id: 'role-1', code: 'OPERATOR', name: 'Operator', permissions: [{ permission: { code: 'task.read' } }] };
const operator = (overrides: Record<string, unknown> = {}) => ({
  id: 'operator-2',
  email: 'new@example.test',
  fullName: 'New Operator',
  passwordHash: 'hashed-password',
  status: OperatorStatus.ACTIVE,
  role,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createHarness = () => {
  const prisma = {
    operator: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    role: { findUnique: jest.fn() },
    operatorSession: { updateMany: jest.fn() },
    $transaction: jest.fn((callback) => callback(prisma)),
  };
  return { prisma, service: new OperatorManagementService(prisma as unknown as PrismaService) };
};

describe('OperatorManagementService', () => {
  it('creates an active operator with a bcrypt password hash and safe response', async () => {
    const { prisma, service } = createHarness();
    prisma.role.findUnique.mockResolvedValue(role);
    prisma.operator.findUnique.mockResolvedValue(null);
    prisma.operator.create.mockImplementation(({ data }) => Promise.resolve(operator({ ...data, passwordHash: data.passwordHash })));

    const result = await service.create({ email: 'new@example.test', fullName: 'New Operator', password: 'safe-password', roleId: 'role-1' });

    expect(prisma.operator.create.mock.calls[0][0].data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.role).toEqual(expect.objectContaining({ code: 'OPERATOR' }));
  });

  it('rejects duplicate emails and revokes sessions when deactivating an operator', async () => {
    const { prisma, service } = createHarness();
    prisma.role.findUnique.mockResolvedValue(role);
    prisma.operator.findUnique.mockResolvedValueOnce(operator());
    await expect(service.create({ email: 'new@example.test', fullName: 'New Operator', password: 'safe-password', roleId: 'role-1' })).rejects.toThrow(
      ConflictException,
    );

    prisma.operator.findUnique.mockResolvedValueOnce(operator());
    prisma.operator.update.mockResolvedValue(operator({ status: OperatorStatus.INACTIVE }));
    prisma.operatorSession.updateMany.mockResolvedValue({ count: 1 });
    await service.deactivate('operator-2', 'admin-1');
    expect(prisma.operatorSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { operatorId: 'operator-2', revokedAt: null } }),
    );
  });
});
