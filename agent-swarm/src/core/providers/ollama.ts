export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  schema?: object;
  timeout?: number;
}

export interface LLMProvider {
  name: string;
  chat(options: LLMCallOptions): Promise<string>;
  chatStream?(options: LLMCallOptions): AsyncGenerator<string, void, unknown>;
  isAvailable(): boolean;
}

export abstract class BaseLLMProvider implements LLMProvider {
  abstract name: string;

  abstract chat(options: LLMCallOptions): Promise<string>;

  abstract isAvailable(): boolean;

  protected cleanResponse(text: string): string {
    return text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
}

export class OllamaProvider extends BaseLLMProvider {
  name = 'ollama';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    super();
    this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  isAvailable(): boolean {
    return process.env.OLLAMA_ENABLED !== 'false';
  }

  async chat(options: LLMCallOptions): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 120000);

    const requestBody: Record<string, unknown> = {
      model: options.model,
      messages: options.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      stream: false,
    };

    if (options.contextWindow) {
      requestBody.options = { num_ctx: options.contextWindow };
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as { message?: { content?: string } };
      return this.cleanResponse(data.message?.content || '');
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}