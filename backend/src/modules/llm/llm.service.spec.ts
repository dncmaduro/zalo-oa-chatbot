import { LlmService } from './llm.service';
import { LocalLlmProvider } from './providers/local-llm.provider';
import { OpenAiLlmProvider } from './providers/openai-llm.provider';

describe('LlmService', () => {
  const originalEnvironment = {
    provider: process.env.LLM_PROVIDER,
    model: process.env.LLM_MODEL,
    localBaseUrl: process.env.LOCAL_LLM_BASE_URL,
    openAiApiKey: process.env.OPENAI_API_KEY,
  };

  afterEach(() => {
    restoreEnvironmentVariable('LLM_PROVIDER', originalEnvironment.provider);
    restoreEnvironmentVariable('LLM_MODEL', originalEnvironment.model);
    restoreEnvironmentVariable('LOCAL_LLM_BASE_URL', originalEnvironment.localBaseUrl);
    restoreEnvironmentVariable('OPENAI_API_KEY', originalEnvironment.openAiApiKey);
  });

  it('selects only the local provider when LLM_PROVIDER=local', () => {
    process.env.LLM_PROVIDER = 'local';
    process.env.LLM_MODEL = 'qwen3:8b';
    process.env.LOCAL_LLM_BASE_URL = 'http://localhost:11434';
    delete process.env.OPENAI_API_KEY;

    expect((new LlmService() as any).getProvider()).toBeInstanceOf(LocalLlmProvider);
  });

  it('selects only the OpenAI provider when LLM_PROVIDER=openai', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_MODEL = 'configured-chat-model';
    process.env.OPENAI_API_KEY = 'test-key';

    expect((new LlmService() as any).getProvider()).toBeInstanceOf(OpenAiLlmProvider);
  });

  function restoreEnvironmentVariable(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});
