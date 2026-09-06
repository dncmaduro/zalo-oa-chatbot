export interface LlmStructuredRequest {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
}

export interface LlmProvider {
  readonly model: string;

  generateStructured(request: LlmStructuredRequest): Promise<unknown>;
}
