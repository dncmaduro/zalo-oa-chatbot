import OpenAI from 'openai';

import { LlmProvider, LlmStructuredRequest } from '../llm-provider.interface';

export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    public readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async generateStructured(request: LlmStructuredRequest): Promise<unknown> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      store: false,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    });
    const content = completion.choices[0]?.message.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('OpenAI returned no structured chat output.');
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new Error('OpenAI returned malformed structured JSON.');
    }
  }
}
