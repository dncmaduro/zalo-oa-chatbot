import { Logger } from '@nestjs/common';

import { LocalLlmProvider } from './local-llm.provider';
import { OpenAiLlmProvider } from './openai-llm.provider';

describe('LLM providers', () => {
  const originalFetch = global.fetch;
  const originalPerformanceLogging = process.env.LLM_PERF_LOG;

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalPerformanceLogging === undefined) {
      delete process.env.LLM_PERF_LOG;
    } else {
      process.env.LLM_PERF_LOG = originalPerformanceLogging;
    }

    jest.restoreAllMocks();
  });

  it('uses bounded deterministic structured-output settings for local Ollama chat', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content:
            '{"selectedKnowledgeItemKey":null,"selectedDocumentSectionKey":null,"supportingDocumentSectionKeys":[],"collectedFields":{}}',
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new LocalLlmProvider('qwen3:8b', 'http://localhost:11434/');

    await provider.generateStructured({
      systemPrompt: 'system',
      userPrompt: 'user',
      metadata: { purpose: 'chat_resolve', correlationId: 'conversation-1:message-1' },
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.any(Object));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: 'qwen3:8b',
      stream: false,
      format: 'json',
      think: false,
      keep_alive: '30m',
      options: {
        temperature: 0,
        num_predict: 128,
      },
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user' },
      ],
    });
  });

  it('allows a caller to further bound local Ollama output without changing keep_alive', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{"ready":true}' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new LocalLlmProvider('qwen3:8b', 'http://localhost:11434');

    await provider.generateStructured({ systemPrompt: 'system', userPrompt: 'warmup', maxOutputTokens: 16 });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      keep_alive: '30m',
      think: false,
      options: { temperature: 0, num_predict: 16 },
    });
  });

  it('does not receive Ollama-specific options in the OpenAI provider request', async () => {
    const provider = new OpenAiLlmProvider('test-key', 'configured-chat-model');
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"selectedKnowledgeItemKey":null}' } }],
    });
    (provider as any).client = {
      chat: {
        completions: { create },
      },
    };

    await provider.generateStructured({
      systemPrompt: 'system',
      userPrompt: 'user',
      metadata: { purpose: 'chat_resolve', correlationId: 'conversation-1:message-1' },
    });

    const request = create.mock.calls[0][0];
    expect(request).toMatchObject({
      model: 'configured-chat-model',
      store: false,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    expect(request).not.toHaveProperty('think');
    expect(request).not.toHaveProperty('keep_alive');
    expect(request).not.toHaveProperty('metadata');
    expect(request.options).toBeUndefined();
  });

  it('logs only concise Ollama performance metrics when enabled', async () => {
    process.env.LLM_PERF_LOG = 'true';
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '{"selectedKnowledgeItemKey":null}' },
        total_duration: 3_500_000_000,
        load_duration: 500_000_000,
        prompt_eval_count: 100,
        prompt_eval_duration: 2_000_000_000,
        eval_count: 50,
        eval_duration: 1_000_000_000,
      }),
    }) as unknown as typeof fetch;
    const provider = new LocalLlmProvider('qwen3:8b', 'http://localhost:11434');

    await provider.generateStructured({
      systemPrompt: 'secret system',
      userPrompt: 'secret user message',
      metadata: { purpose: 'chat_resolve', correlationId: 'conversation-1:message-1' },
    });

    const performanceLog = JSON.parse(log.mock.calls[0][0]);
    expect(performanceLog).toMatchObject({
      event: 'ollama_llm_performance',
      model: 'qwen3:8b',
      purpose: 'chat_resolve',
      correlationId: 'conversation-1:message-1',
      totalDurationNs: 3_500_000_000,
      loadDurationNs: 500_000_000,
      promptEvalDurationNs: 2_000_000_000,
      evalDurationNs: 1_000_000_000,
      promptEvalCount: 100,
      evalCount: 50,
      totalSeconds: 3.5,
      loadSeconds: 0.5,
      promptTokens: 100,
      promptEvalSeconds: 2,
      promptTokensPerSecond: 50,
      promptMsPerToken: 20,
      generatedTokens: 50,
      generationSeconds: 1,
      generatedTokensPerSecond: 50,
      generationMsPerToken: 20,
    });
  });
});
