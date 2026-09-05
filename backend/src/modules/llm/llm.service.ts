import { Injectable } from '@nestjs/common';

import { LlmProvider, LlmStructuredRequest } from './llm-provider.interface';
import { LocalLlmProvider } from './providers/local-llm.provider';
import { OpenAiLlmProvider } from './providers/openai-llm.provider';

@Injectable()
export class LlmService {
  private provider: LlmProvider | undefined;

  get model(): string {
    return this.getProvider().model;
  }

  generateStructured(request: LlmStructuredRequest): Promise<unknown> {
    return this.getProvider().generateStructured(request);
  }

  private getProvider(): LlmProvider {
    if (this.provider) {
      return this.provider;
    }

    const providerName = process.env.LLM_PROVIDER?.trim().toLowerCase();

    switch (providerName) {
      case 'local':
        this.provider = new LocalLlmProvider(
          this.getRequiredEnvironmentVariable('LLM_MODEL'),
          this.getRequiredEnvironmentVariable('LOCAL_LLM_BASE_URL'),
        );
        return this.provider;
      case 'openai':
        this.provider = new OpenAiLlmProvider(
          this.getRequiredEnvironmentVariable('OPENAI_API_KEY'),
          this.getRequiredEnvironmentVariable('LLM_MODEL'),
        );
        return this.provider;
      default:
        throw new Error('LLM_PROVIDER must be set to either "local" or "openai".');
    }
  }

  private getRequiredEnvironmentVariable(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new Error(`${name} must be configured for chat resolve.`);
    }

    return value;
  }
}
