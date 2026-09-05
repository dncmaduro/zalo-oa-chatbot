import { Module } from '@nestjs/common';

import { LlmModule } from '../llm/llm.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

import { ChatController } from './chat.controller';
import { ChatResolveService } from './chat-resolve.service';
import { ChatRagContextService } from './rag/chat-rag-context.service';

@Module({
  imports: [KnowledgeModule, LlmModule],
  controllers: [ChatController],
  providers: [ChatResolveService, ChatRagContextService],
})
export class ChatModule {}
