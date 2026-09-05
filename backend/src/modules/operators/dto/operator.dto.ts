import { BadRequestException } from '@nestjs/common';

import { OperatorStatus } from '../../../generated/prisma/client';

const MAX_PASSWORD_LENGTH = 128;

export class CreateOperatorDto {
  email!: string;
  fullName!: string;
  password!: string;
  roleId!: string;
}

export class UpdateOperatorDto {
  fullName?: string;
  roleId?: string;
}

export function normalizeCreateOperator(input: unknown) {
  const body = asRecord(input);
  return {
    email: normalizeEmail(body.email),
    fullName: normalizeText(body.fullName, 'fullName', 255),
    password: normalizePassword(body.password),
    roleId: normalizeText(body.roleId, 'roleId', 255),
  };
}

export function normalizeUpdateOperator(input: unknown) {
  const body = asRecord(input);
  const fullName = body.fullName === undefined ? undefined : normalizeText(body.fullName, 'fullName', 255);
  const roleId = body.roleId === undefined ? undefined : normalizeText(body.roleId, 'roleId', 255);
  if (fullName === undefined && roleId === undefined) throw new BadRequestException('At least one update field is required');
  return { fullName, roleId };
}

export function normalizeOperatorListQuery(input: Record<string, unknown>) {
  const status = input.status;
  if (status !== undefined && !Object.values(OperatorStatus).includes(status as OperatorStatus)) {
    throw new BadRequestException('status is invalid');
  }
  return {
    status: status as OperatorStatus | undefined,
    roleId: input.role === undefined ? undefined : normalizeText(input.role, 'role', 255),
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function normalizeEmail(value: unknown): string {
  const email = normalizeText(value, 'email', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('email is invalid');
  return email;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > MAX_PASSWORD_LENGTH) {
    throw new BadRequestException(`password must be between 8 and ${MAX_PASSWORD_LENGTH} characters`);
  }
  return value;
}

function normalizeText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new BadRequestException(`${field} must not exceed ${maxLength} characters`);
  return normalized;
}
