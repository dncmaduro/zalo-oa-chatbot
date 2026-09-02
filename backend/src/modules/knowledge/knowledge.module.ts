import { Module } from '@nestjs/common';

import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeRetrievalService } from './retrieval/knowledge-retrieval.service';

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeRetrievalService],
})
export class KnowledgeModule {}
