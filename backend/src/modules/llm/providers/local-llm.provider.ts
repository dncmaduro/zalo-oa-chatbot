import { Logger } from '@nestjs/common';

import { LlmProvider, LlmStructuredRequest } from '../llm-provider.interface';

// A decision is one key, optional supporting keys, and a small field map.
// 128 tokens leaves room for valid JSON while avoiding answer-generation headroom.
const DECISION_NUM_PREDICT = 128;

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class LocalLlmProvider implements LlmProvider {
  private readonly logger = new Logger(LocalLlmProvider.name);

  constructor(
    public readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async generateStructured(request: LlmStructuredRequest): Promise<unknown> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: 'json',
        think: false,
        keep_alive: '30m',
        options: {
          temperature: 0,
          num_predict: DECISION_NUM_PREDICT,
        },
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat request failed: ${response.status} ${response.statusText}.`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    this.logPerformance(data);
    const content = data.message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Ollama returned no structured chat output.');
    }

    return this.parseJson(content, 'Ollama');
  }

  private parseJson(content: string, providerName: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      throw new Error(`${providerName} returned malformed structured JSON.`);
    }
  }

  private logPerformance(data: OllamaChatResponse): void {
    if (!this.isPerformanceLoggingEnabled()) {
      return;
    }

    const promptEvaluationSeconds = this.toSeconds(data.prompt_eval_duration);
    const generationSeconds = this.toSeconds(data.eval_duration);

    this.logger.log(
      JSON.stringify({
        event: 'ollama_llm_performance',
        model: this.model,
        totalSeconds: this.toSeconds(data.total_duration),
        loadSeconds: this.toSeconds(data.load_duration),
        promptTokens: this.toCount(data.prompt_eval_count),
        promptEvalSeconds: promptEvaluationSeconds,
        promptTokensPerSecond: this.toTokensPerSecond(data.prompt_eval_count, promptEvaluationSeconds),
        generatedTokens: this.toCount(data.eval_count),
        generationSeconds,
        generatedTokensPerSecond: this.toTokensPerSecond(data.eval_count, generationSeconds),
      }),
    );
  }

  private isPerformanceLoggingEnabled(): boolean {
    return process.env.LLM_PERF_LOG?.trim().toLowerCase() === 'true';
  }

  private toSeconds(duration: number | undefined): number | null {
    if (typeof duration !== 'number' || !Number.isFinite(duration)) {
      return null;
    }

    return Number((duration / 1_000_000_000).toFixed(3));
  }

  private toCount(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private toTokensPerSecond(tokenCount: number | undefined, durationSeconds: number | null): number | null {
    if (
      typeof tokenCount !== 'number' ||
      !Number.isFinite(tokenCount) ||
      durationSeconds === null ||
      durationSeconds <= 0
    ) {
      return null;
    }

    return Number((tokenCount / durationSeconds).toFixed(2));
  }
}
