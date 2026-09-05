import { Logger } from '@nestjs/common';

import { LocalEmbeddingProvider } from './local-embedding.provider';
import { OpenAIEmbeddingProvider } from './openai-embedding.provider';

describe('embedding providers', () => {
  const originalFetch = global.fetch;
  const originalPerformanceLogging = process.env.LLM_PERF_LOG;

  beforeEach(() => {
    process.env.LLM_PERF_LOG = 'false';
  });

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalPerformanceLogging === undefined) {
      delete process.env.LLM_PERF_LOG;
    } else {
      process.env.LLM_PERF_LOG = originalPerformanceLogging;
    }

    jest.restoreAllMocks();
  });

  it('sends the configured supported keep_alive value to local Ollama embedding requests', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new LocalEmbeddingProvider('qwen3-embedding:0.6b', 'http://localhost:11434/', '45m');

    await expect(provider.embed('embedding input')).resolves.toEqual([0.1, 0.2, 0.3]);

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/embed', expect.any(Object));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: 'qwen3-embedding:0.6b',
      input: 'embedding input',
      keep_alive: '45m',
    });
  });

  it('logs only concise local embedding timing when performance logging is enabled', async () => {
    process.env.LLM_PERF_LOG = 'true';
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1]] }),
    }) as unknown as typeof fetch;
    const provider = new LocalEmbeddingProvider('qwen3-embedding:0.6b', 'http://localhost:11434');

    await provider.embed('private query');

    const performanceLog = log.mock.calls
      .map(([message]) => JSON.parse(message as string))
      .find((entry) => entry.event === 'ollama_embedding_performance');

    expect(performanceLog).toEqual({
      event: 'ollama_embedding_performance',
      model: 'qwen3-embedding:0.6b',
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(performanceLog)).not.toContain('private query');
  });

  it('does not apply local Ollama fields to the OpenAI embedding provider', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key', 'text-embedding-3-small');
    const create = jest.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] });
    (provider as any).client = { embeddings: { create } };

    await expect(provider.embed('embedding input')).resolves.toEqual([0.1, 0.2]);

    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'embedding input',
      encoding_format: 'float',
    });
  });
});
