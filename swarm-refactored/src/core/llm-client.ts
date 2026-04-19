import { z } from 'zod';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  fallback_model?: string;
  schema?: object;
  max_tokens?: number;
}

interface LLMResponse {
  content: string;
  model: string;
  cached?: boolean;
}

const AGENT_MODEL_CONFIG = {
  commander: {
    primary: process.env.COMMANDER_MODEL || 'qwen3.5:4b',
    fallback: process.env.COMMANDER_MODEL_FALLBACK || 'qwen2.5-coder:7b-instruct',
    temperature: 0.3,
  },
  alpha: {
    primary: process.env.RECON_MODEL || 'qwen2.5-coder:7b-instruct',
    fallback: process.env.RECON_MODEL_FALLBACK || 'qwen2.5-coder:7b-instruct',
    temperature: 0.2,
  },
  gamma: {
    primary: process.env.EXPLOIT_MODEL || 'qwen2.5-coder:7b-instruct',
    fallback: process.env.EXPLOIT_MODEL_FALLBACK || 'qwen2.5-coder:7b-instruct',
    temperature: 0.1,
  },
  critic: {
    primary: process.env.CRITIC_MODEL || 'qwen2.5-coder:7b-instruct',
    fallback: process.env.CRITIC_MODEL_FALLBACK || 'qwen2.5-coder:7b-instruct',
    temperature: 0.1,
  },
} as const;

const OPENROUTER_CASCADE: string[] = [];

const CASCADE_TIMEOUT = 15000;

function isOllamaModel(model: string): boolean {
  return !model.includes('/');
}

function hasOpenRouterKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export class LLMClient {
  private openRouterClient: OpenRouterClient;
  private ollamaClient: OllamaClient;

  constructor() {
    this.openRouterClient = new OpenRouterClient();
    this.ollamaClient = new OllamaClient();
  }

  async chat(options: ChatOptions): Promise<string> {
    const {
      model,
      messages,
      temperature,
      fallback_model,
      schema,
    } = options;

    if (isOllamaModel(model)) {
      return this.chatWithOllama(model, messages, temperature ?? 0.3);
    }

    if (hasOpenRouterKey()) {
      try {
        return await this.chatWithOpenRouter(model, messages, temperature ?? 0.3, schema);
      } catch (error) {
        console.warn('OpenRouter cascade exhausted, falling back to Ollama');
      }
    }

    const ollamaModel = fallback_model || 'qwen2.5-coder:7b-instruct';
    return this.chatWithOllama(ollamaModel, messages, temperature ?? 0.3, schema);
  }

  private async chatWithOpenRouter(
    model: string,
    messages: ChatMessage[],
    temperature: number,
    schema?: object
  ): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('No OpenRouter API key');

    const models = [model, ...OPENROUTER_CASCADE.filter((m) => m !== model)];

    for (const currentModel of models) {
      try {
        const response = await this.openRouterClient.chat(
          currentModel,
          messages,
          temperature,
          apiKey,
          schema,
          CASCADE_TIMEOUT
        );
        return response;
      } catch (error) {
        console.warn(`OpenRouter model ${currentModel} failed:`, error);
        continue;
      }
    }

    throw new Error('All OpenRouter models exhausted');
  }

  private async chatWithOllama(
    model: string,
    messages: ChatMessage[],
    temperature: number,
    schema?: object
  ): Promise<string> {
    try {
      return await this.ollamaClient.chat(model, messages, temperature, schema);
    } catch (error) {
      console.warn(`Ollama model ${model} failed:`, error);
      const fallbackModel = 'qwen2.5-coder:7b-instruct';
      if (fallbackModel !== model) {
        return this.ollamaClient.chat(fallbackModel, messages, temperature, schema);
      }
      throw error;
    }
  }

  async chatForAgent(
    agent: 'commander' | 'alpha' | 'gamma' | 'critic',
    messages: ChatMessage[],
    schema?: object
  ): Promise<string> {
    const config = AGENT_MODEL_CONFIG[agent];
    return this.chat({
      model: config.primary,
      messages,
      temperature: config.temperature,
      fallback_model: config.fallback,
      schema,
    });
  }

  getModelForAgent(agent: 'commander' | 'alpha' | 'gamma' | 'critic'): string {
    return AGENT_MODEL_CONFIG[agent].primary;
  }
}

class OpenRouterClient {
  private baseUrl = 'https://openrouter.ai/api/v1';

  async chat(
    model: string,
    messages: ChatMessage[],
    temperature: number,
    apiKey: string,
    schema?: object,
    timeout: number = 15000
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://swarm.local',
          'X-Title': 'Swarm Agent',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          ...(schema && {
            response_format: {
              type: 'json_object',
              schema,
            },
          }),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content || '';
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

class OllamaClient {
  private baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  async chat(
    model: string,
    messages: ChatMessage[],
    temperature: number,
    schema?: object
  ): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          temperature,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama /api/chat error: ${response.status}`);
      }

      const data = await response.json() as { message?: { content?: string } };
      let text = data.message?.content || '';
      
      text = text.replace(/^```json\s*/i, '');
      text = text.replace(/\s*```$/i, '');
      text = text.trim();
      
      return text;
    } catch (error) {
      console.warn(`[Ollama] /api/chat failed: ${error}, falling back to /api/generate`);
      return this.chatWithGenerate(model, messages, temperature, schema);
    }
  }

  private async chatWithGenerate(
    model: string,
    messages: ChatMessage[],
    temperature: number,
    schema?: object
  ): Promise<string> {
    console.warn(`[Ollama] Using /api/generate fallback for model: ${model}`);
    
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: this.messagesToPrompt(messages),
        temperature,
        stream: false,
        ...(schema && {
          grammar: this.schemaToOllamaGrammar(schema),
        }),
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama /api/generate error: ${response.status}`);
    }

    const data = await response.json() as { response?: string };
    let text = data.response || '';
    
    text = text.replace(/^```json\s*/i, '');
    text = text.replace(/\s*```$/i, '');
    text = text.trim();
    
    return text;
  }

  private messagesToPrompt(messages: ChatMessage[]): string {
    return messages
      .map((m) => {
        if (m.role === 'system') {
          return `SYSTEM: ${m.content}`;
        }
        if (m.role === 'user') {
          return `USER: ${m.content}`;
        }
        return `ASSISTANT: ${m.content}`;
      })
      .join('\n\n');
  }

  private schemaToOllamaGrammar(schema: object): string {
    const schemaStr = JSON.stringify(schema);
    let grammar = schemaStr
      .replace(/"type":\s*"object"/g, '"type": "object"')
      .replace(/"type":\s*"string"/g, '"type": "string"')
      .replace(/"type":\s*"number"/g, '"type": "number"')
      .replace(/"type":\s*"boolean"/g, '"type": "boolean"')
      .replace(/"type":\s*"array"/g, '"type": "array"')
      .replace(/"enum":\s*\[([^\]]+)\]/g, '"enum": [$1]');

    return grammar;
  }
}

export function tryParseJSON(text: string): { success: true; data: object } | { success: false; error: string } {
  try {
    const data = JSON.parse(text);
    return { success: true, data };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function repairJSON(text: string): string {
  let repaired = text.trim();
  
  repaired = repaired.replace(/^```json\s*/i, '');
  repaired = repaired.replace(/^```\s*/i, '');
  repaired = repaired.replace(/\s*```$/i, '');
  
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
  }
  
  const openBraces = (repaired.match(/{/g) || []).length;
  let closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  let closeBrackets = (repaired.match(/\]/g) || []).length;
  
  while (openBraces > closeBraces) {
    repaired += '}';
    closeBraces++;
  }
  while (openBrackets > closeBrackets) {
    repaired += ']';
    closeBrackets++;
  }
  
  const lastOpen = repaired.lastIndexOf('{');
  const lastClose = repaired.lastIndexOf('}');
  if (lastOpen > lastClose) {
    const nextBracket = repaired.indexOf('[', lastOpen);
    const nextClose = repaired.indexOf('}', lastOpen);
    if (nextBracket !== -1 && (nextClose === -1 || nextBracket < nextClose)) {
    } else if (lastClose < lastOpen) {
      repaired = repaired.substring(0, lastClose + 1);
    }
  }
  
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
  }
  
  const jsonMatch = repaired.match(/\{[\s\S]*"/);
  if (jsonMatch) {
    const tryStart = jsonMatch.index!;
    const tryText = repaired.substring(tryStart);
    try {
      JSON.parse(tryText);
      return tryText;
    } catch {
    }
  }
  
  return repaired;
}

export const llmClient = new LLMClient();

export { AGENT_MODEL_CONFIG };
export type { ChatMessage, ChatOptions };
