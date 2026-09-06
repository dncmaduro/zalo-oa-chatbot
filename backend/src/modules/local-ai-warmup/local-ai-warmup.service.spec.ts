import { Logger } from '@nestjs/common';

import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';

import { LocalAiWarmupService } from './local-ai-warmup.service';

describe('LocalAiWarmupService', () => {
  const environmentNames = [
    'LOCAL_AI_WARMUP_ENABLED',
    'LLM_PROVIDER',
    'LLM_MODEL',
    'EMBEDDING_PROVIDER',
    'EMBEDDING_MODEL',
  ] as const;
  const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

  const createHarness = () => {
    const llm = { generateStructured: jest.fn().mockResolvedValue({ ready: true }) };
    const embedding = { embed: jest.fn().mockResolvedValue([0.1]) };
    return {
      llm,
      embedding,
      service: new LocalAiWarmupService(llm as unknown as LlmService, embedding as unknown as EmbeddingService),
    };
  };

  beforeEach(() => {
    process.env.LOCAL_AI_WARMUP_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'local';
    process.env.LLM_MODEL = 'qwen3:8b';
    process.env.EMBEDDING_PROVIDER = 'local';
    process.env.EMBEDDING_MODEL = 'qwen3-embedding:0.6b';
  });

  afterEach(() => {
    for (const name of environmentNames) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    jest.restoreAllMocks();
  });

  it('does nothing when warm-up is disabled', async () => {
    process.env.LOCAL_AI_WARMUP_ENABLED = 'false';
    const { service, llm, embedding } = createHarness();

    await expect(service.warmIfEnabled()).resolves.toBeUndefined();
    expect(llm.generateStructured).not.toHaveBeenCalled();
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it('warms both configured local providers through their service abstractions', async () => {
    const { service, llm, embedding } = createHarness();

    await expect(service.warmIfEnabled()).resolves.toBeUndefined();
    expect(embedding.embed).toHaveBeenCalledWith('warmup');
    expect(llm.generateStructured).toHaveBeenCalledWith({
      systemPrompt: 'Return exactly the JSON object {"ready":true}.',
      userPrompt: 'Confirm readiness.',
      maxOutputTokens: 16,
    });
  });

  it('does not warm OpenAI providers', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.EMBEDDING_PROVIDER = 'openai';
    const { service, llm, embedding } = createHarness();

    await service.warmIfEnabled();
    expect(llm.generateStructured).not.toHaveBeenCalled();
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it.each([
    ['local', 'openai', 1, 0],
    ['openai', 'local', 0, 1],
  ])('warms only the local provider for mixed configuration (%s LLM, %s embedding)', async (llmProvider, embeddingProvider, llmCalls, embeddingCalls) => {
    process.env.LLM_PROVIDER = llmProvider;
    process.env.EMBEDDING_PROVIDER = embeddingProvider;
    const { service, llm, embedding } = createHarness();

    await service.warmIfEnabled();
    expect(llm.generateStructured).toHaveBeenCalledTimes(llmCalls);
    expect(embedding.embed).toHaveBeenCalledTimes(embeddingCalls);
  });

  it('logs provider/model timing and aborts readiness when an enabled local warm-up fails', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service, llm } = createHarness();
    llm.generateStructured.mockRejectedValue(new Error('Ollama unavailable'));

    await expect(service.warmIfEnabled()).rejects.toThrow('Local AI warm-up failed; application readiness aborted.');
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('"provider":"llm","model":"qwen3:8b"'),
    );
  });
});
