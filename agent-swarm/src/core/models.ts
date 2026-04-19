/**
 * Solaris Agent Model Configuration
 * 
 * Benchmark Results Summary:
 * ========================
 * FASTEST:  llama-3.3-70b-versatile (Groq) @ 367ms - 100% valid JSON
 * PLANNING: qwen-3-235b-a22b-instruct-2507 (Cerebras) @ 471ms - 100% valid JSON
 * FREE:     nvidia/nemotron-3-nano-30b-a3b:free (OpenRouter) @ 3.7s - 100% valid JSON
 * 
 * Ollama models scored poorly (0-17% valid JSON) - only use for non-JSON tasks
 */

export interface AgentModelConfig {
  primary: string;
  fallback: string;
  temperature: number;
  maxTokens?: number;
  contextWindow?: number;
  provider: 'ollama' | 'groq' | 'cerebras' | 'openrouter' | 'anthropic' | 'google' | 'minimax';
}

export const AGENT_MODEL_CONFIG: Record<string, AgentModelConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: NANO AGENTS - Simple validation/critique (Ollama - local, fast)
  // ═══════════════════════════════════════════════════════════════════════════
  // Note: Ollama models are fast but poor at JSON (0-17%). These agents
  // primarily do simple text comparisons, not JSON generation.
  
  verifier: {
    primary: process.env.VERIFIER_MODEL || 'phi3:3.8b-mini-128k-instruct-q4_K_M',
    fallback: process.env.VERIFIER_MODEL_FALLBACK || 'llama3.1:8b-instruct-q4_K_M',
    temperature: 0.0,
    maxTokens: 2048,
    provider: 'ollama',
  },
  critic: {
    primary: process.env.CRITIC_MODEL || 'phi3:3.8b-mini-128k-instruct-q4_K_M',
    fallback: process.env.CRITIC_MODEL_FALLBACK || 'llama3.1:8b-instruct-q4_K_M',
    temperature: 0.15,
    maxTokens: 4096,
    provider: 'ollama',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: EXPLOIT AGENTS - Command/JSON generation (Ollama + Groq fallback)
  // ═══════════════════════════════════════════════════════════════════════════
  // Note: Ollama is fast but unreliable for JSON. Use Groq kimi-k2-instruct
  // as fallback for reliable JSON generation.
  
  gamma: {
    primary: process.env.GAMMA_MODEL || 'MiniMax-M2.7',
    fallback: process.env.GAMMA_MODEL_FALLBACK || 'gemma4:e2b',
    temperature: 0.75,
    maxTokens: 8192,
    contextWindow: 32768,
    provider: 'minimax',
  },
  alpha: {
    primary: process.env.ALPHA_MODEL || 'MiniMax-M2.7',
    fallback: process.env.ALPHA_MODEL_FALLBACK || 'gemma4:e2b',
    temperature: 0.65,
    maxTokens: 8192,
    contextWindow: 32768,
    provider: 'minimax',
  },
  mcp: {
    primary: process.env.MCP_MODEL || 'llama3-groq-tool-use:8b-q4_K_M',
    fallback: process.env.MCP_MODEL_FALLBACK || 'moonshotai/kimi-k2-instruct',
    temperature: 0.65,
    maxTokens: 8192,
    provider: 'ollama',
  },
  specialist: {
    primary: process.env.SPECIALIST_MODEL || 'llama3-groq-tool-use:8b-q4_K_M',
    fallback: process.env.SPECIALIST_MODEL_FALLBACK || 'moonshotai/kimi-k2-instruct',
    temperature: 0.85,
    maxTokens: 8192,
    provider: 'ollama',
  },
  post_exploit: {
    primary: process.env.POST_MODEL || 'qwen2.5-coder:7b-instruct-q4_K_M',
    fallback: process.env.POST_MODEL_FALLBACK || 'moonshotai/kimi-k2-instruct',
    temperature: 0.65,
    maxTokens: 8192,
    provider: 'ollama',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: COMMANDER - High-level reasoning (Groq - FASTEST @ 367ms)
  // ═══════════════════════════════════════════════════════════════════════════
  
  commander: {
    primary: process.env.COMMANDER_MODEL || 'llama-3.3-70b-versatile',
    fallback: process.env.COMMANDER_MODEL_FALLBACK || 'moonshotai/kimi-k2-instruct',
    temperature: 0.5,
    maxTokens: 16384,
    provider: 'groq',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 4: PLANNING AGENTS - Mission/chain planning (Cerebras @ 471ms)
  // ═══════════════════════════════════════════════════════════════════════════
  
  mission_planner: {
    primary: process.env.PLANNER_MODEL || 'qwen-3-235b-a22b-instruct-2507',
    fallback: process.env.PLANNER_MODEL_FALLBACK || 'moonshotai/kimi-k2-instruct',
    temperature: 0.85,
    maxTokens: 16384,
    provider: 'cerebras',
  },
  chain_planner: {
    primary: process.env.CHAIN_MODEL || 'qwen-3-235b-a22b-instruct-2507',
    fallback: process.env.CHAIN_MODEL_FALLBACK || 'moonshotai/kimi-k2-instruct',
    temperature: 0.85,
    maxTokens: 16384,
    provider: 'cerebras',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 5: OSINT - Intelligence gathering (Cerebras)
  // ═══════════════════════════════════════════════════════════════════════════
  
  osint: {
    primary: process.env.OSINT_MODEL || 'llama-3.1-8b',
    fallback: process.env.OSINT_MODEL_FALLBACK || 'qwen-3-235b-a22b-instruct-2507',
    temperature: 0.65,
    maxTokens: 16384,
    provider: 'cerebras',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 6: REPORT AGENT - Report generation (OpenRouter free @ 3.7s)
  // ═══════════════════════════════════════════════════════════════════════════
  
  report_agent: {
    primary: process.env.REPORT_MODEL || 'nvidia/nemotron-3-nano-30b-a3b:free',
    fallback: process.env.REPORT_MODEL_FALLBACK || 'qwen-3-235b-a22b-instruct-2507',
    temperature: 0.3,
    maxTokens: 65536,
    provider: 'openrouter',
  },
} as const;

export type AgentType = keyof typeof AGENT_MODEL_CONFIG;
