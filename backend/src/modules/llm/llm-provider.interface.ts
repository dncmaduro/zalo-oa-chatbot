export interface LlmStructuredRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface LlmProvider {
  readonly model: string;

  generateStructured(request: LlmStructuredRequest): Promise<unknown>;
}
