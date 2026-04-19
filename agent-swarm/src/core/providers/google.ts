import type { LLMCallOptions, LLMProvider } from './ollama.js';

export class GoogleProvider implements LLMProvider {
  name = 'google';

  isAvailable(): boolean {
    return !!process.env.GOOGLE_API_KEY;
  }

  async chat(options: LLMCallOptions): Promise<string> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_API_KEY not set');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 60000);

    try {
      const systemMessage = options.messages.find(m => m.role === 'system');
      const otherMessages = options.messages.filter(m => m.role !== 'system');

      const contents = otherMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens ?? 8192,
        },
      };

      if (systemMessage) {
        body.systemInstruction = { parts: [{ text: systemMessage.content }] };
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Google ${response.status}: ${err}`);
      }

      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const part = data.candidates?.[0]?.content?.parts?.[0];
      return part?.text || '';
    } finally {
      clearTimeout(timeoutId);
    }
  }
}