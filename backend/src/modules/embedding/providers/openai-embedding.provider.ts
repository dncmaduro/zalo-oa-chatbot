import OpenAI from 'openai';

import { EmbeddingProvider } from '../embedding-provider.interface';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    public readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      encoding_format: 'float',
    });
    const embedding = response.data[0]?.embedding;

    if (!embedding) {
      throw new Error('OpenAI returned no embedding vector.');
    }

    return embedding;
  }
}
