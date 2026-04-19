import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // FalkorDB (Graph Database)
  FALKORDB_HOST: z.string().default('localhost'),
  FALKORDB_PORT: z.string().default('6379'),
  FALKORDB_USERNAME: z.string().default('falkordb'),
  FALKORDB_PASSWORD: z.string().optional(),
  FALKORDB_DATABASE: z.string().default('0'),
  
  // Supabase
  SUPABASE_URL: z.string(),
  SUPABASE_ANON_KEY: z.string(),
  
  // SQLite Event Bus
  SQLITE_EVENTS_PATH: z.string().default('./solaris-events.db'),
  
  // Ollama
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5-coder:14b'),
  OLLAMA_ENABLED: z.enum(['true', 'false']).default('false'),
  
  // Minimax
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_BASE_URL: z.string().default('https://api.minimax.io/v1'),
  
  // OSINT APIs
  TAVILY_API_KEY: z.string().optional(),
  NVD_API_KEY: z.string().optional(),
  
  // PM2 / Agent Pool
  GAMMA_POOL_MAX: z.coerce.number().default(3),
  GAMMA_MEMORY_LIMIT: z.string().default('2G'),
  TOOL_TIMEOUT_MS: z.coerce.number().default(30000),
  
  // Security
  AUTHORIZATION_HMAC_SECRET: z.string().optional(),
  CREDENTIAL_VAULT_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let config: EnvConfig | null = null;

export function loadConfig(): EnvConfig {
  if (config) return config;
  
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.flatten());
    throw new Error('Configuration validation failed');
  }
  
  config = result.data;
  return config;
}

export function getConfig(): EnvConfig {
  if (!config) {
    return loadConfig();
  }
  return config;
}

// Auto-load in non-test environments
if (process.env.NODE_ENV !== 'test') {
  loadConfig();
}
