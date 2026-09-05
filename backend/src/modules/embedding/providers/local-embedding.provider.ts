import { Logger } from '@nestjs/common';

import { EmbeddingProvider } from '../embedding-provider.interface';

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(LocalEmbeddingProvider.name);

  constructor(
    public readonly model: string,
    private readonly baseUrl = 'http://localhost:11434',
    private readonly keepAlive = '30m',
  ) {}

  async embed(text: string): Promise<number[]> {
    const startedAt = Date.now();
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/embed`, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        model: this.model,
        input: text,
        keep_alive: this.keepAlive,
      }),
    });

    if (!response.ok) {
      const body = await response.text();

      throw new Error(`Ollama embedding request failed: ` + `${response.status} ${response.statusText}. ${body}`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    this.logPerformance(Date.now() - startedAt);

    const embedding = data.embeddings?.[0];

    if (!embedding || embedding.length === 0) {
      throw new Error('Ollama returned no embedding vector.');
    }

    return embedding;
  }

  private logPerformance(durationMs: number): void {
    if (process.env.LLM_PERF_LOG?.trim().toLowerCase() !== 'true') {
      return;
    }

    this.logger.log(
      JSON.stringify({
        event: 'ollama_embedding_performance',
        model: this.model,
        durationMs,
      }),
    );
  }
}
