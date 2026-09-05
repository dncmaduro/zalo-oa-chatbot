import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { OperatorRoleCode, OperatorStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password-hash';

@Injectable()
export class OperatorManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { status?: OperatorStatus; roleId?: string }) {
    const operators = await this.prisma.operator.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.roleId ? { roleId: query.roleId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.roleInclude(),
    });
    return operators.map((operator) => this.toSafeOperator(operator));
  }

  async detail(operatorId: string) {
    const operator = await this.prisma.operator.findUnique({ where: { id: operatorId }, include: this.roleInclude() });
    if (!operator) throw new NotFoundException('Operator was not found');
    return this.toSafeOperator(operator);
  }

  async create(input: { email: string; fullName: string; password: string; roleId: string }) {
    const role = await this.prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new NotFoundException('Role was not found');
    const existing = await this.prisma.operator.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An operator with this email already exists');

    try {
      const operator = await this.prisma.operator.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          passwordHash: await hashPassword(input.password),
          roleId: role.id,
          status: OperatorStatus.ACTIVE,
        },
        include: this.roleInclude(),
      });
      return this.toSafeOperator(operator);
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('An operator with this email already exists');
      throw error;
    }
  }

  async update(operatorId: string, input: { fullName?: string; roleId?: string }) {
    const operator = await this.prisma.operator.findUnique({ where: { id: operatorId }, include: { role: true } });
    if (!operator) throw new NotFoundException('Operator was not found');
    if (input.roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: input.roleId } });
      if (!role) throw new NotFoundException('Role was not found');
      if (operator.status === OperatorStatus.ACTIVE && operator.role.code === OperatorRoleCode.ADMIN && role.code !== OperatorRoleCode.ADMIN) {
        await this.assertNotLastActiveAdmin(operatorId);
      }
    }
    const updated = await this.prisma.operator.update({
      where: { id: operatorId },
      data: { ...(input.fullName ? { fullName: input.fullName } : {}), ...(input.roleId ? { roleId: input.roleId } : {}) },
      include: this.roleInclude(),
    });
    return this.toSafeOperator(updated);
  }

  async activate(operatorId: string) {
    return this.setStatus(operatorId, OperatorStatus.ACTIVE);
  }

  async deactivate(operatorId: string, actorId: string) {
    if (operatorId === actorId) throw new ConflictException('Operators cannot deactivate themselves');
    const operator = await this.prisma.operator.findUnique({ where: { id: operatorId }, include: { role: true } });
    if (!operator) throw new NotFoundException('Operator was not found');
    if (operator.status === OperatorStatus.ACTIVE && operator.role.code === OperatorRoleCode.ADMIN) {
      await this.assertNotLastActiveAdmin(operatorId);
    }
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.operator.update({
        where: { id: operatorId },
        data: { status: OperatorStatus.INACTIVE },
        include: this.roleInclude(),
      });
      await transaction.operatorSession.updateMany({
        where: { operatorId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return this.toSafeOperator(updated);
    });
  }

  private async setStatus(operatorId: string, status: OperatorStatus) {
    const operator = await this.prisma.operator.findUnique({ where: { id: operatorId } });
    if (!operator) throw new NotFoundException('Operator was not found');
    const updated = await this.prisma.operator.update({ where: { id: operatorId }, data: { status }, include: this.roleInclude() });
    return this.toSafeOperator(updated);
  }

  private async assertNotLastActiveAdmin(operatorId: string) {
    const activeAdminCount = await this.prisma.operator.count({
      where: { status: OperatorStatus.ACTIVE, role: { code: OperatorRoleCode.ADMIN } },
    });
    if (activeAdminCount <= 1) throw new ConflictException('Cannot remove or deactivate the last active administrator');
  }

  private roleInclude() {
    return { role: { include: { permissions: { include: { permission: { select: { code: true } } } } } } };
  }

  private toSafeOperator(operator: any) {
    return {
      id: operator.id,
      email: operator.email,
      fullName: operator.fullName,
      status: operator.status,
      createdAt: operator.createdAt,
      updatedAt: operator.updatedAt,
      role: { id: operator.role.id, code: operator.role.code, name: operator.role.name },
      permissions: operator.role.permissions.map((entry: any) => entry.permission.code).sort(),
    };
  }
}
