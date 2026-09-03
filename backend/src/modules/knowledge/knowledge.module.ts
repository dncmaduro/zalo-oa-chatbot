import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding/embedding.module';

import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeRetrievalService } from './retrieval/knowledge-retrieval.service';
import { SemanticKnowledgeRetrievalService } from './retrieval/semantic-knowledge-retrieval.service';

@Module({
  imports: [EmbeddingModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeRetrievalService, SemanticKnowledgeRetrievalService],
})
export class KnowledgeModule {}
