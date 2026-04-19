import type { LLMCallOptions, LLMProvider } from './ollama.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async chat(options: LLMCallOptions): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 60000);

    try {
      const systemMessage = options.messages.find(m => m.role === 'system');
      const otherMessages = options.messages.filter(m => m.role !== 'system');

      const body: Record<string, unknown> = {
        model: options.model,
        messages: otherMessages.map(m => ({ role: m.role, content: m.content })),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      };

      if (systemMessage) {
        body.system = systemMessage.content;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Anthropic ${response.status}: ${err}`);
      }

      const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
      const textContent = data.content?.find(c => c.type === 'text');
      return textContent?.text || '';
    } finally {
      clearTimeout(timeoutId);
    }
  }
}