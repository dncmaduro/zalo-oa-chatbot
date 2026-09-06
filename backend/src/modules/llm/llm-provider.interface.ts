export type LlmRequestPurpose = 'chat_resolve' | 'task_continuation' | 'warmup' | 'operator_response_generation';

export interface LlmStructuredRequest {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
  metadata?: {
    purpose: LlmRequestPurpose;
    correlationId?: string;
  };
}

export interface LlmProvider {
  readonly model: string;

  generateStructured(request: LlmStructuredRequest): Promise<unknown>;
}
