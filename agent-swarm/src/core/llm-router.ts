import { AGENT_MODEL_CONFIG, type AgentType } from './models.js';
import type { LLMMessage, LLMProvider } from './providers/ollama.js';
import { OllamaProvider } from './providers/ollama.js';
import { GroqProvider } from './providers/groq.js';
import { CerebrasProvider } from './providers/cerebras.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GoogleProvider } from './providers/google.js';
import { MinimaxProvider } from './providers/minimax.js';

export class LLMRouter {
  private providers: Map<string, LLMProvider>;

  constructor() {
    this.providers = new Map([
      ['ollama', new OllamaProvider()],
      ['groq', new GroqProvider()],
      ['cerebras', new CerebrasProvider()],
      ['openrouter', new OpenRouterProvider()],
      ['anthropic', new AnthropicProvider()],
      ['google', new GoogleProvider()],
      ['minimax', new MinimaxProvider()],
    ]);
  }

  async complete(
    agentType: AgentType,
    messages: LLMMessage[],
    overrides?: Partial<{ temperature: number; maxTokens: number; contextWindow: number; schema: object }>
  ): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of this.completeStream(agentType, messages, overrides)) {
      chunks.push(chunk);
    }
    return chunks.join('');
  }

  async *completeStream(
    agentType: AgentType,
    messages: LLMMessage[],
    overrides?: Partial<{ temperature: number; maxTokens: number; contextWindow: number; schema: object }>
  ): AsyncGenerator<string, void, unknown> {
    const config = AGENT_MODEL_CONFIG[agentType];
    if (!config) throw new Error(`Unknown agent type: ${agentType}`);

    const temperature = overrides?.temperature ?? config.temperature;
    const maxTokens = overrides?.maxTokens ?? config.maxTokens ?? 8192;
    const contextWindow = overrides?.contextWindow ?? config.contextWindow;

    const primaryProvider = this.providers.get(config.provider);
    if (primaryProvider?.isAvailable() && primaryProvider.chatStream) {
      try {
        for await (const chunk of primaryProvider.chatStream({
          model: config.primary,
          messages,
          temperature,
          maxTokens,
          contextWindow,
          schema: overrides?.schema,
          timeout: 120000,
        })) {
          yield chunk;
        }
        return;
      } catch (error) {
        console.warn(`[LLMRouter] Primary ${config.provider}/${config.primary} stream failed: ${error}`);
      }
    }

    for (const [name, provider] of this.providers) {
      if (provider.isAvailable() && provider.chatStream) {
        try {
          for await (const chunk of provider.chatStream({
            model: config.fallback,
            messages,
            temperature,
            maxTokens,
            contextWindow,
            schema: overrides?.schema,
            timeout: 120000,
          })) {
            yield chunk;
          }
          return;
        } catch (error) {
          console.warn(`[LLMRouter] Fallback ${name}/${config.fallback} stream failed: ${error}`);
        }
      }
    }

    throw new Error(`[LLMRouter] No streaming provider available for agent ${agentType}`);
  }
}

export const llmRouter = new LLMRouter();