import { BadRequestException } from '@nestjs/common';

import { OperatorTaskStatus } from '../../../generated/prisma/client';

const MAX_RESULT_LENGTH = 8_000;
const MAX_DRAFT_LENGTH = 4_000;
const MAX_OUTCOME_LENGTH = 64;

export class AssignOperatorTaskDto {
  operatorId!: string;
}

export class SubmitOperatorTaskResultDto {
  outcome?: string;
  result!: string;
}

export class EditOperatorTaskDraftDto {
  draftResponse!: string;
}

export interface OperatorTaskListQuery {
  status?: OperatorTaskStatus;
  assignee?: string;
  operatorTaskType?: string;
  conversationId?: string;
}

export function normalizeOperatorId(value: unknown, fieldName = 'operatorId'): string {
  return normalizeRequiredString(value, fieldName, 255);
}

export function normalizeSubmittedResult(input: unknown) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const result = normalizeRequiredString(body.result, 'result', MAX_RESULT_LENGTH);
  const outcome = body.outcome === undefined ? null : normalizeRequiredString(body.outcome, 'outcome', MAX_OUTCOME_LENGTH);

  return { result, outcome };
}

export function normalizeDraftResponse(input: EditOperatorTaskDraftDto): string {
  return normalizeRequiredString(input.draftResponse, 'draftResponse', MAX_DRAFT_LENGTH);
}

export function normalizeOperatorTaskListQuery(input: Record<string, unknown>): OperatorTaskListQuery {
  const query: OperatorTaskListQuery = {};

  if (input.status !== undefined) {
    if (!Object.values(OperatorTaskStatus).includes(input.status as OperatorTaskStatus)) {
      throw new BadRequestException('status is invalid');
    }
    query.status = input.status as OperatorTaskStatus;
  }
  if (input.assignee !== undefined) query.assignee = normalizeRequiredString(input.assignee, 'assignee', 255);
  if (input.operatorTaskType !== undefined) {
    query.operatorTaskType = normalizeRequiredString(input.operatorTaskType, 'operatorTaskType', 255);
  }
  if (input.conversationId !== undefined) {
    query.conversationId = normalizeRequiredString(input.conversationId, 'conversationId', 255);
  }

  return query;
}

function normalizeRequiredString(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a non-empty string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new BadRequestException(`${fieldName} must not be empty`);
  }
  if (normalized.length > maxLength) {
    throw new BadRequestException(`${fieldName} must not exceed ${maxLength} characters`);
  }

  return normalized;
}
