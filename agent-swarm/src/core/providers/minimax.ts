import type { LLMCallOptions, LLMProvider } from './ollama.js';

export class MinimaxProvider implements LLMProvider {
  name = 'minimax';

  isAvailable(): boolean {
    return !!process.env.MINIMAX_API_KEY;
  }

  async chat(options: LLMCallOptions): Promise<string> {
    let full = '';
    for await (const chunk of this.chatStream(options)) {
      full += chunk;
    }
    return full;
  }

  async *chatStream(options: LLMCallOptions): AsyncGenerator<string, void, unknown> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) throw new Error('MINIMAX_API_KEY not set');

    const baseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 120000);

    try {
      const response = await fetch(`${baseUrl}/text/chatcompletion_v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 8192,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Minimax ${response.status}: ${err}`);
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) yield content;
            } catch {
              // skip malformed lines
            }
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
