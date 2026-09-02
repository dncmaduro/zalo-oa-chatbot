export interface EmbeddingProvider {
  readonly model: string;

  embed(text: string): Promise<number[]>;
}
