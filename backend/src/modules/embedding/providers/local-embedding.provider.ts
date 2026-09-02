import { EmbeddingProvider } from '../embedding-provider.interface';

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  constructor(
    public readonly model: string,
    private readonly baseUrl = 'http://localhost:11434',
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/embed`, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();

      throw new Error(`Ollama embedding request failed: ` + `${response.status} ${response.statusText}. ${body}`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;

    const embedding = data.embeddings?.[0];

    if (!embedding || embedding.length === 0) {
      throw new Error('Ollama returned no embedding vector.');
    }

    return embedding;
  }
}
