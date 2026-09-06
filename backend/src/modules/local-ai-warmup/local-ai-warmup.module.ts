import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding/embedding.module';
import { LlmModule } from '../llm/llm.module';

import { LocalAiWarmupService } from './local-ai-warmup.service';

@Module({
  imports: [LlmModule, EmbeddingModule],
  providers: [LocalAiWarmupService],
  exports: [LocalAiWarmupService],
})
export class LocalAiWarmupModule {}
