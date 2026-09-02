import { Module } from '@nestjs/common';

import { EmbeddingService } from './embedding.service';
import { KnowledgeEmbeddingBackfillService } from './knowledge-embedding-backfill.service';
import { KnowledgeEmbeddingContentService } from './knowledge-embedding-content.service';

@Module({
  providers: [EmbeddingService, KnowledgeEmbeddingContentService, KnowledgeEmbeddingBackfillService],
  exports: [EmbeddingService, KnowledgeEmbeddingBackfillService],
})
export class EmbeddingModule {}
