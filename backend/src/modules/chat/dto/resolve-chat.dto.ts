import { KnowledgeAudience } from '../../../generated/prisma/client';

export class ResolveChatDto {
  message!: string;

  audience?: KnowledgeAudience;
}
