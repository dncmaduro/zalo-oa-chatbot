import { BadRequestException } from '@nestjs/common';

import { HumanContactStatus } from '../../../generated/prisma/client';

const MAX_NOTE_LENGTH = 4_000;
const MAX_REPLY_LENGTH = 4_000;

export class AssignHumanContactDto {
  operatorId!: string;
}

export class AddHumanContactNoteDto {
  note!: string;
}

export class ReplyHumanContactDto {
  message!: string;
}

export interface HumanContactListQuery {
  status?: HumanContactStatus;
  assignee?: string;
  conversationId?: string;
}

export function normalizeHumanContactOperatorId(value: unknown): string {
  return normalizeRequiredText(value, 'operatorId', 255);
}

export function normalizeHumanContactNote(input: unknown): string {
  return normalizeRequiredText(asRecord(input).note, 'note', MAX_NOTE_LENGTH);
}

export function normalizeHumanContactReply(input: unknown): string {
  return normalizeRequiredText(asRecord(input).message, 'message', MAX_REPLY_LENGTH);
}

export function normalizeHumanContactListQuery(input: Record<string, unknown>): HumanContactListQuery {
  const query: HumanContactListQuery = {};
  if (input.status !== undefined) {
    if (!Object.values(HumanContactStatus).includes(input.status as HumanContactStatus)) {
      throw new BadRequestException('status is invalid');
    }
    query.status = input.status as HumanContactStatus;
  }
  if (input.assignee !== undefined) query.assignee = normalizeRequiredText(input.assignee, 'assignee', 255);
  if (input.conversationId !== undefined) query.conversationId = normalizeRequiredText(input.conversationId, 'conversationId', 255);
  return query;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function normalizeRequiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be a non-empty string`);
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException(`${field} must not be empty`);
  if (normalized.length > maxLength) throw new BadRequestException(`${field} must not exceed ${maxLength} characters`);
  return normalized;
}
