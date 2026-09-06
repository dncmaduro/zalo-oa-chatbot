import { Module } from '@nestjs/common';

import { LlmModule } from '../llm/llm.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

import { ChatController } from './chat.controller';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { ChatResolveService } from './chat-resolve.service';
import { ChatRagContextService } from './rag/chat-rag-context.service';
import { TaskFieldCollectionService } from './task-field-collection.service';

@Module({
  imports: [KnowledgeModule, LlmModule],
  controllers: [ChatController],
  providers: [ChatResolveService, ChatOrchestratorService, ChatRagContextService, TaskFieldCollectionService],
})
export class ChatModule {}
