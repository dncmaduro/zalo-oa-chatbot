import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';

const WARMUP_TEXT = 'warmup';
const WARMUP_SYSTEM_PROMPT = 'Return exactly the JSON object {"ready":true}.';
const WARMUP_USER_PROMPT = 'Confirm readiness.';
const WARMUP_MAX_OUTPUT_TOKENS = 16;

type LocalProviderKind = 'llm' | 'embedding';

@Injectable()
export class LocalAiWarmupService {
  private readonly logger = new Logger(LocalAiWarmupService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Invoked by the HTTP bootstrap path before the application listens. Keeping
   * this explicit avoids warming Nest application contexts used by CLI commands.
   */
  async warmIfEnabled(): Promise<void> {
    if (!this.isEnabled()) return;

    const startedAt = performance.now();
    const warmups: Array<Promise<void>> = [];

    if (this.isLocalProvider('LLM_PROVIDER')) {
      warmups.push(this.warmLlm());
    }
    if (this.isLocalProvider('EMBEDDING_PROVIDER')) {
      warmups.push(this.warmEmbedding());
    }
    if (warmups.length === 0) {
      this.logger.log(JSON.stringify({ event: 'local_ai_warmup_skipped', reason: 'no_local_providers' }));
      return;
    }

    const results = await Promise.allSettled(warmups);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    if (failures.length > 0) {
      const failureSummary = failures.map((failure) => this.errorMessage(failure.reason)).join('; ');
      this.logger.error(
        JSON.stringify({
          event: 'local_ai_warmup_failed',
          totalMs: this.elapsedMs(startedAt),
          failures: failureSummary,
        }),
      );
      throw new Error(`Local AI warm-up failed; application readiness aborted. ${failureSummary}`);
    }

    this.logger.log(JSON.stringify({ event: 'local_ai_warmup_ready', totalMs: this.elapsedMs(startedAt) }));
  }

  private async warmLlm(): Promise<void> {
    await this.runWarmup('llm', this.configuredModel('LLM_MODEL'), () =>
      this.llmService.generateStructured({
        systemPrompt: WARMUP_SYSTEM_PROMPT,
        userPrompt: WARMUP_USER_PROMPT,
        maxOutputTokens: WARMUP_MAX_OUTPUT_TOKENS,
        metadata: { purpose: 'warmup' },
      }),
    );
  }

  private async warmEmbedding(): Promise<void> {
    await this.runWarmup('embedding', this.configuredModel('EMBEDDING_MODEL'), () => this.embeddingService.embed(WARMUP_TEXT));
  }

  private async runWarmup(kind: LocalProviderKind, model: string, operation: () => Promise<unknown>): Promise<void> {
    const startedAt = performance.now();
    try {
      await operation();
      this.logger.log(
        JSON.stringify({ event: 'local_ai_warmup_complete', provider: kind, model, durationMs: this.elapsedMs(startedAt) }),
      );
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.error(
        JSON.stringify({ event: 'local_ai_warmup_provider_failed', provider: kind, model, durationMs: this.elapsedMs(startedAt), error: message }),
      );
      throw new Error(`${kind} provider (${model}) warm-up failed: ${message}`);
    }
  }

  private isEnabled(): boolean {
    return process.env.LOCAL_AI_WARMUP_ENABLED?.trim().toLowerCase() === 'true';
  }

  private isLocalProvider(environmentVariable: 'LLM_PROVIDER' | 'EMBEDDING_PROVIDER'): boolean {
    return process.env[environmentVariable]?.trim().toLowerCase() === 'local';
  }

  private configuredModel(environmentVariable: 'LLM_MODEL' | 'EMBEDDING_MODEL'): string {
    return process.env[environmentVariable]?.trim() || 'unconfigured';
  }

  private elapsedMs(startedAt: number): number {
    return Math.round(performance.now() - startedAt);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
