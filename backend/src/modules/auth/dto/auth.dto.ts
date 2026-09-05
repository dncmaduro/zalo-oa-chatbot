import { BadRequestException } from '@nestjs/common';

export class LoginDto {
  email!: string;
  password!: string;
}

export function normalizeLogin(input: unknown): { email: string; password: string } {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  if (typeof body.email !== 'string' || !body.email.trim()) throw new BadRequestException('email is required');
  if (typeof body.password !== 'string' || !body.password) throw new BadRequestException('password is required');

  return { email: body.email.trim().toLowerCase(), password: body.password };
}
