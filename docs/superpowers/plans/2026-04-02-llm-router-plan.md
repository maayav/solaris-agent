# LLM Router Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Build the LLM routing layer with full tier cascade (Ollama → Groq → Cerebras → OpenRouter → Anthropic) + per-agent model config from spec.

**Architecture:** Single `LLMRouter.complete()` entry point. Agents never call providers directly. Cascade on 429/errors. Rate limiting per provider. Temperature + max_tokens per call.

**Tech Stack:** Bun runtime, fetch API, Zod validation, environment variables.

---

## File Map

```
agent-swarm/src/
├── core/
│   ├── llm-router.ts          # Create: main router class
│   ├── providers/
│   │   ├── ollama.ts          # Create: Ollama provider
│   │   ├── groq.ts            # Create: Groq provider  
│   │   ├── cerebras.ts        # Create: Cerebras provider
│   │   ├── openrouter.ts      # Create: OpenRouter provider
│   │   └── anthropic.ts       # Create: Anthropic provider
│   └── models.ts              # Create: AGENT_MODEL_CONFIG per spec
```

---

## Task 1: Model Config (AGENT_MODEL_CONFIG)

**Files:**
- Create: `agent-swarm/src/core/models.ts`

- [ ] **Step 1: Create model config**

```typescript
// agent-swarm/src/core/models.ts

export interface AgentModelConfig {
  primary: string;
  fallback: string;
  temperature: number;
  maxTokens?: number;
  provider: 'ollama' | 'groq' | 'cerebras' | 'openrouter' | 'anthropic' | 'google';
}

export const AGENT_MODEL_CONFIG: Record<string, AgentModelConfig> = {
  // Tier 1 (Nano, local Ollama)
  verifier: {
    primary: process.env.VERIFIER_MODEL || 'nemotron-3-nano',
    fallback: process.env.VERIFIER_MODEL_FALLBACK || 'nemotron-3-nano',
    temperature: 0.0,
    maxTokens: 2048,
    provider: 'ollama',
  },
  critic: {
    primary: process.env.CRITIC_MODEL || 'nemotron-3-nano',
    fallback: process.env.CRITIC_MODEL_FALLBACK || 'nemotron-3-nano',
    temperature: 0.15,
    maxTokens: 4096,
    provider: 'ollama',
  },
  
  // Tier 2 (Mid, local Ollama)
  gamma: {
    primary: process.env.GAMMA_MODEL || 'qwen2.5:14b-instruct',
    fallback: process.env.GAMMA_MODEL_FALLBACK || 'qwen2.5:14b',
    temperature: 0.85,
    maxTokens: 8192,
    provider: 'ollama',
  },
  alpha: {
    primary: process.env.ALPHA_MODEL || 'qwen2.5:14b-instruct',
    fallback: process.env.ALPHA_MODEL_FALLBACK || 'qwen2.5:14b',
    temperature: 0.65,
    maxTokens: 8192,
    provider: 'ollama',
  },
  mcp: {
    primary: process.env.MCP_MODEL || 'qwen2.5:14b-instruct',
    fallback: process.env.MCP_MODEL_FALLBACK || 'qwen2.5:14b',
    temperature: 0.65,
    maxTokens: 8192,
    provider: 'ollama',
  },
  specialist: {
    primary: process.env.SPECIALIST_MODEL || 'qwen2.5:14b-instruct',
    fallback: process.env.SPECIALIST_MODEL_FALLBACK || 'qwen2.5:14b',
    temperature: 0.85,
    maxTokens: 8192,
    provider: 'ollama',
  },
  post_exploit: {
    primary: process.env.POST_MODEL || 'qwen2.5:14b-instruct',
    fallback: process.env.POST_MODEL_FALLBACK || 'qwen2.5:14b',
    temperature: 0.65,
    maxTokens: 8192,
    provider: 'ollama',
  },
  
  // Tier 3 (Reasoning, cloud)
  commander: {
    primary: process.env.COMMANDER_MODEL || 'nvidia/nemotron-3-super',
    fallback: process.env.COMMANDER_MODEL_FALLBACK || 'google/gemini-2.0-flash',
    temperature: 0.5,
    maxTokens: 16384,
    provider: 'openrouter',
  },
  
  // Tier 4 (Planning, cloud)
  mission_planner: {
    primary: process.env.PLANNER_MODEL || 'google/gemini-2.0-flash',
    fallback: process.env.PLANNER_MODEL_FALLBACK || 'groq/llama-3.3-70b',
    temperature: 0.85,
    maxTokens: 16384,
    provider: 'google',
  },
  chain_planner: {
    primary: process.env.CHAIN_MODEL || 'google/gemini-2.0-flash',
    fallback: process.env.CHAIN_MODEL_FALLBACK || 'groq/llama-3.3-70b',
    temperature: 0.85,
    maxTokens: 16384,
    provider: 'google',
  },
  osint: {
    primary: process.env.OSINT_MODEL || 'google/gemini-2.0-flash',
    fallback: process.env.OSINT_MODEL_FALLBACK || 'groq/llama-3.3-70b',
    temperature: 0.65,
    maxTokens: 16384,
    provider: 'google',
  },
  
  // Tier 5 (Output, cloud)
  report_agent: {
    primary: process.env.REPORT_MODEL || 'google/gemini-1.5-pro',
    fallback: process.env.REPORT_MODEL_FALLBACK || 'openrouter/anthropic/claude-3.5-haiku',
    temperature: 0.3,
    maxTokens: 65536,
    provider: 'google',
  },
} as const;

export type AgentType = keyof typeof AGENT_MODEL_CONFIG;
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/core/models.ts
git commit -m "feat(core): add AGENT_MODEL_CONFIG with tier hierarchy per spec"
```

---

## Task 2: Provider Interfaces

**Files:**
- Create: `agent-swarm/src/core/providers/ollama.ts`
- Create: `agent-swarm/src/core/providers/groq.ts`
- Create: `agent-swarm/src/core/providers/cerebras.ts`
- Create: `agent-swarm/src/core/providers/openrouter.ts`
- Create: `agent-swarm/src/core/providers/anthropic.ts`

- [ ] **Step 1: Create provider interface + Ollama**

```typescript
// agent-swarm/src/core/providers/ollama.ts

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  schema?: object;  // for structured output
  timeout?: number;
}

export interface LLMProvider {
  name: string;
  chat(options: LLMCallOptions): Promise<string>;
  isAvailable(): boolean;
}

// Ollama provider
export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }
  
  isAvailable(): boolean {
    return process.env.OLLAMA_ENABLED !== 'false';
  }
  
  async chat(options: LLMCallOptions): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 60000);
    
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages.map(m => ({ role: m.role, content: m.content })),
          temperature: options.temperature ?? 0.7,
          stream: false,
        }),
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
  
  private cleanResponse(text: string): string {
    return text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
}
```

- [ ] **Step 2: Create Groq provider**

```typescript
// agent-swarm/src/core/providers/groq.ts
import type { LLMCallOptions, LLMProvider } from './ollama.js';

export class GroqProvider implements LLMProvider {
  name = 'groq';
  
  isAvailable(): boolean {
    return !!process.env.GROQ_API_KEY;
  }
  
  async chat(options: LLMCallOptions): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);
    
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq ${response.status}: ${err}`);
      }
      
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content || '';
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

- [ ] **Step 3: Create Cerebras, OpenRouter, Anthropic providers**

Follow the same pattern as Groq. Each provider:
- Checks `isAvailable()` via env var presence
- Calls correct endpoint
- Returns cleaned string response
- Uses AbortController for timeout

**Commit after all 5 providers:**

```bash
git add agent-swarm/src/core/providers/
git commit -m "feat(core): add all LLM providers - Ollama, Groq, Cerebras, OpenRouter, Anthropic"
```

---

## Task 3: LLMRouter class

**Files:**
- Create: `agent-swarm/src/core/llm-router.ts`

- [ ] **Step 1: Create LLMRouter**

```typescript
// agent-swarm/src/core/llm-router.ts
import { AGENT_MODEL_CONFIG, type AgentType } from './models.js';
import type { LLMMessage, LLMCallOptions } from './providers/ollama.js';
import { OllamaProvider } from './providers/ollama.js';
import { GroqProvider } from './providers/groq.js';
import { CerebrasProvider } from './providers/cerebras.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { AnthropicProvider } from './providers/anthropic.js';
import type { LLMProvider } from './providers/ollama.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class LLMRouter {
  private providers: Map<string, LLMProvider>;
  private rateLimits = new Map<string, RateLimitEntry>();
  
  // Cascade order per provider type
  private readonly CASCADE: Record<string, string[]> = {
    ollama: ['ollama'],
    groq: ['groq', 'openrouter', 'anthropic'],
    cerebras: ['cerebras', 'openrouter', 'anthropic'],
    openrouter: ['openrouter', 'anthropic'],
    anthropic: ['anthropic'],
    google: ['google', 'openrouter', 'anthropic'],
  };
  
  // Default model cascades (fallback when primary fails)
  private readonly DEFAULT_CASCADE: Record<string, string[]> = {
    'nvidia/nemotron-3-super': ['openrouter/anthropic/nvidia/nemotron-3-super', 'google/gemini-2.0-flash'],
    'google/gemini-2.0-flash': ['groq/llama-3.3-70b', 'openrouter/meta-llama/llama-3.3-70b'],
    'google/gemini-1.5-pro': ['openrouter/google/gemini-1.5-pro', 'openrouter/anthropic/claude-3.5-haiku'],
  };

  constructor() {
    this.providers = new Map([
      ['ollama', new OllamaProvider()],
      ['groq', new GroqProvider()],
      ['cerebras', new CerebrasProvider()],
      ['openrouter', new OpenRouterProvider()],
      ['anthropic', new AnthropicProvider()],
    ]);
  }
  
  async complete(
    agentType: AgentType,
    messages: LLMMessage[],
    overrides?: Partial<{ temperature: number; maxTokens: number; schema: object }>
  ): Promise<string> {
    const config = AGENT_MODEL_CONFIG[agentType];
    if (!config) throw new Error(`Unknown agent type: ${agentType}`);
    
    const temperature = overrides?.temperature ?? config.temperature;
    const maxTokens = overrides?.maxTokens ?? config.maxTokens ?? 8192;
    
    // Try primary provider first
    const primaryProvider = this.providers.get(config.provider);
    if (primaryProvider?.isAvailable()) {
      try {
        return await this.callProvider(primaryProvider, config.primary, messages, temperature, maxTokens, overrides?.schema);
      } catch (error) {
        console.warn(`[LLMRouter] Primary ${config.provider}/${config.primary} failed: ${error}`);
      }
    }
    
    // Try cascade
    const cascade = this.DEFAULT_CASCADE[config.primary] || [];
    for (const model of cascade) {
      const providerName = this.providerForModel(model);
      const provider = this.providers.get(providerName);
      if (provider?.isAvailable()) {
        try {
          return await this.callProvider(provider, model, messages, temperature, maxTokens, overrides?.schema);
        } catch (error) {
          console.warn(`[LLMRouter] Cascade ${providerName}/${model} failed: ${error}`);
        }
      }
    }
    
    // Last resort: any available provider
    for (const [name, provider] of this.providers) {
      if (provider.isAvailable()) {
        try {
          return await this.callProvider(provider, config.fallback, messages, temperature, maxTokens, overrides?.schema);
        } catch (error) {
          console.warn(`[LLMRouter] Fallback ${name}/${config.fallback} failed: ${error}`);
        }
      }
    }
    
    throw new Error(`[LLMRouter] All providers exhausted for agent ${agentType}`);
  }
  
  private async callProvider(
    provider: LLMProvider,
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    schema?: object
  ): Promise<string> {
    // Check rate limit
    const rateKey = `${provider.name}:${model}`;
    if (this.isRateLimited(rateKey)) {
      throw new Error(`Rate limited: ${rateKey}`);
    }
    
    const options: LLMCallOptions = {
      model,
      messages,
      temperature,
      maxTokens,
      schema,
      timeout: 120000,
    };
    
    const result = await provider.chat(options);
    this.recordRequest(rateKey);
    return result;
  }
  
  private isRateLimited(key: string): boolean {
    const entry = this.rateLimits.get(key);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
      this.rateLimits.delete(key);
      return false;
    }
    return entry.count >= this.getLimit(key);
  }
  
  private getLimit(key: string): number {
    if (key.startsWith('ollama:')) return 60; // 60 req/min local
    if (key.startsWith('groq:')) return 30;
    if (key.startsWith('cerebras:')) return 20;
    return 60;
  }
  
  private recordRequest(key: string): void {
    const now = Date.now();
    const resetAt = now + 60000;
    const existing = this.rateLimits.get(key);
    if (existing && now < existing.resetAt) {
      existing.count++;
    } else {
      this.rateLimits.set(key, { count: 1, resetAt });
    }
  }
  
  private providerForModel(model: string): string {
    if (model.includes('/')) {
      const [provider] = model.split('/');
      return provider;
    }
    return 'ollama';
  }
}

export const llmRouter = new LLMRouter();
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/core/llm-router.ts
git commit -m "feat(core): add LLMRouter with full cascade - Ollama→Groq→Cerebras→OpenRouter→Anthropic"
```

---

## Task 4: Add to BaseAgent

**Files:**
- Modify: `agent-swarm/src/agents/base-agent.ts`

- [ ] **Step 1: Add LLM client to BaseAgent**

```typescript
import { llmRouter } from '../core/llm-router.js';
import type { LLMMessage } from '../core/providers/ollama.js';

export abstract class BaseAgent {
  // ... existing fields ...
  
  protected async llmComplete(
    messages: LLMMessage[],
    overrides?: { temperature?: number; maxTokens?: number; schema?: object }
  ): Promise<string> {
    const agentType = this.agentType as AgentType;
    return llmRouter.complete(agentType, messages, overrides);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/agents/base-agent.ts
git commit -m "feat(agents): add llmComplete() to BaseAgent using LLMRouter"
```
