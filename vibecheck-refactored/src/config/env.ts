import { z } from "zod";

const testDefaults: Record<string, string> = process.env.NODE_ENV === "test" ? {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_KEY: "test-key",
  NEO4J_PASSWORD: "test-password",
  NEO4J_URI: "bolt://localhost:7687",
} : {};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().min(1).max(65535).default(8000),
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),

  // LLM Provider selection
  LLM_PROVIDER: z.enum(["ollama", "openrouter"]).default("ollama"),

  // Neo4j Aura (Graph DB)
  NEO4J_URI: z.string().default(testDefaults.NEO4J_URI ?? "bolt://localhost:7687"),
  NEO4J_USERNAME: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().min(1).default(testDefaults.NEO4J_PASSWORD ?? "placeholder"),

  // Qdrant Cloud (Vector DB)
  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),

  // Upstash Redis (Message Queue)
  REDIS_URL: z.string().default("redis://localhost:6380"),

  // Supabase (Relational DB - unchanged)
  SUPABASE_URL: z.string().url().default(testDefaults.SUPABASE_URL ?? "https://placeholder.supabase.co"),
  SUPABASE_SERVICE_KEY: z.string().min(1).default(testDefaults.SUPABASE_SERVICE_KEY ?? "placeholder"),

  // Ollama (Local LLM via Cloudflare Tunnel)
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5-coder:7b-instruct"),
  OLLAMA_EMBED_MODEL: z.string().default("nomic-embed-text"),

  // Cloudflare Access (for Ollama tunnel security)
  CF_ACCESS_CLIENT_ID: z.string().optional(),
  CF_ACCESS_CLIENT_SECRET: z.string().optional(),

  // OpenRouter API (Cloud LLM)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_PRIMARY_MODEL: z.string().default("arcee-ai/trinity-large-preview:free"),
  OPENROUTER_FALLBACK_MODEL: z.string().default("z-ai/glm-4.5-air:free"),
  OPENROUTER_HTTP_REFERER: z.string().optional(),

  // API configuration
  INTERNAL_API_KEY: z.string().min(1).default("dev-api-key"),
  API_VERSION: z.string().default("v0"),
  ALLOWED_ORIGINS: z
    .string()
    .transform((val) => val.split(",").map((s) => s.trim()))
    .default("*"),

  // Worker configuration
  MAX_CONCURRENT_SCANS: z.coerce.number().default(3),
  SCAN_TIMEOUT_MS: z.coerce.number().default(300000),
  REPO_CLONE_DIR: z.string().default("/tmp/vibecheck/repos"),
  MAX_REPO_SIZE_MB: z.coerce.number().default(500),
  SEMGREP_BIN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const isTest = process.env.NODE_ENV === "test";
  if (isTest) {
    console.warn("⚠️  Environment validation failed in test mode - using defaults where possible");
  } else {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
}

export const env = parsed.data as Env;
export type Env = z.infer<typeof envSchema>;
