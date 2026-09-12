import { BadRequestException } from '@nestjs/common';

import { ChatChannel, KnowledgeAudience } from '../../../generated/prisma/client';

export class CreateChatMessageDto {
  externalUserId!: string;
  channel!: ChatChannel;
  message!: string;
  audience?: KnowledgeAudience;
}

export interface NormalizedChatMessageInput {
  externalUserId: string;
  channel: ChatChannel;
  message: string;
  audience: KnowledgeAudience;
  idempotencyKey?: string;
}

export function normalizeChatMessageInput(input: CreateChatMessageDto): NormalizedChatMessageInput {
  const externalUserId = normalizeRequiredString(input.externalUserId, 'externalUserId');
  const message = normalizeRequiredString(input.message, 'message');

  if (!Object.values(ChatChannel).includes(input.channel)) {
    throw new BadRequestException('channel is invalid');
  }

  const audience = input.audience ?? KnowledgeAudience.CUSTOMER;

  if (!Object.values(KnowledgeAudience).includes(audience)) {
    throw new BadRequestException('audience is invalid');
  }

  return { externalUserId, channel: input.channel, message, audience };
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a non-empty string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new BadRequestException(`${fieldName} must not be empty`);
  }

  return normalized;
}
