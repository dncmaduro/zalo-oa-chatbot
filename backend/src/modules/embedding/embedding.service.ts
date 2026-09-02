import { Injectable } from '@nestjs/common';

import { EmbeddingProvider } from './embedding-provider.interface';
import { LocalEmbeddingProvider } from './providers/local-embedding.provider';
import { OpenAIEmbeddingProvider } from './providers/openai-embedding.provider';

@Injectable()
export class EmbeddingService {
  private provider: EmbeddingProvider | undefined;

  get model(): string {
    return this.getProvider().model;
  }

  async embed(text: string): Promise<number[]> {
    return this.getProvider().embed(text);
  }

  private getProvider(): EmbeddingProvider {
    if (this.provider) {
      return this.provider;
    }

    const providerName = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();

    switch (providerName) {
      case 'local':
        this.provider = new LocalEmbeddingProvider(
          this.getRequiredEnvironmentVariable('EMBEDDING_MODEL'),
          process.env.LOCAL_EMBEDDING_BASE_URL?.trim() || undefined,
        );
        return this.provider;
      case 'openai':
        this.provider = new OpenAIEmbeddingProvider(
          this.getRequiredEnvironmentVariable('OPENAI_API_KEY'),
          this.getRequiredEnvironmentVariable('EMBEDDING_MODEL'),
        );
        return this.provider;
      default:
        throw new Error('EMBEDDING_PROVIDER must be set to either "local" or "openai".');
    }
  }

  private getRequiredEnvironmentVariable(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new Error(`${name} must be configured for embedding backfill.`);
    }

    return value;
  }
}
