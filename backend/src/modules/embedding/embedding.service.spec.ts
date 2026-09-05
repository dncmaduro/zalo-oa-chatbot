import { EmbeddingService } from './embedding.service';
import { LocalEmbeddingProvider } from './providers/local-embedding.provider';

describe('EmbeddingService', () => {
  const originalProvider = process.env.EMBEDDING_PROVIDER;
  const originalModel = process.env.EMBEDDING_MODEL;
  const originalBaseUrl = process.env.LOCAL_EMBEDDING_BASE_URL;
  const originalKeepAlive = process.env.LOCAL_EMBEDDING_KEEP_ALIVE;

  afterEach(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };

    restore('EMBEDDING_PROVIDER', originalProvider);
    restore('EMBEDDING_MODEL', originalModel);
    restore('LOCAL_EMBEDDING_BASE_URL', originalBaseUrl);
    restore('LOCAL_EMBEDDING_KEEP_ALIVE', originalKeepAlive);
  });

  it('passes LOCAL_EMBEDDING_KEEP_ALIVE to the local provider', () => {
    process.env.EMBEDDING_PROVIDER = 'local';
    process.env.EMBEDDING_MODEL = 'qwen3-embedding:0.6b';
    process.env.LOCAL_EMBEDDING_BASE_URL = 'http://localhost:11434';
    process.env.LOCAL_EMBEDDING_KEEP_ALIVE = '45m';

    const service = new EmbeddingService();
    const provider = (service as any).getProvider();

    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
    expect(provider.keepAlive).toBe('45m');
  });
});
