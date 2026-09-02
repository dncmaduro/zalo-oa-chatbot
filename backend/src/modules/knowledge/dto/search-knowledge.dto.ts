import { KnowledgeAudience } from '../../../generated/prisma/client';

export class SearchKnowledgeDto {
  query!: string;

  audience?: KnowledgeAudience;

  limit?: number;
}
