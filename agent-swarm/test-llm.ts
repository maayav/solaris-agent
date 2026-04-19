#!/usr/bin/env bun
import { getConfig } from './src/config/index.js';
import { AGENT_MODEL_CONFIG } from './src/core/models.js';
import { OllamaProvider } from './src/core/providers/ollama.js';
import { GroqProvider } from './src/core/providers/groq.js';
import { CerebrasProvider } from './src/core/providers/cerebras.js';
import { GoogleProvider } from './src/core/providers/google.js';
import { OpenRouterProvider } from './src/core/providers/openrouter.js';

const TEST_MESSAGE = {
  role: 'user',
  content: 'Say "Hello, this is a test." and nothing else.',
};

const VERIFICATION_MESSAGE = {
  role: 'user',
  content: 'What is 2+2? Answer with just the number.',
};

interface BenchmarkResult {
  provider: string;
  model: string;
  available: boolean;
  latency?: number;
  response?: string;
  error?: string;
}

async function testProvider(
  name: string,
  provider: OllamaProvider | GroqProvider | CerebrasProvider | GoogleProvider | OpenRouterProvider,
  model: string,
  testMessage = TEST_MESSAGE
): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    provider: name,
    model,
    available: false,
  };

  if (!provider.isAvailable()) {
    result.error = 'Not available (no API key or disabled)';
    return result;
  }

  const start = Date.now();
  try {
    const response = await provider.chat({
      model,
      messages: [testMessage],
      temperature: 0.1,
      maxTokens: 100,
      timeout: 30000,
    });
    result.latency = Date.now() - start;
    result.response = response.trim().substring(0, 100);
    result.available = true;
  } catch (error) {
    result.error = String(error).substring(0, 200);
    result.latency = Date.now() - start;
  }

  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('LLM Provider Connectivity & Benchmark Test');
  console.log('='.repeat(60));
  console.log();

  const config = getConfig();
  console.log(`Ollama enabled: ${config.OLLAMA_ENABLED}`);
  console.log(`Ollama base URL: ${config.OLLAMA_BASE_URL}`);
  console.log();

  const providers = {
    ollama: new OllamaProvider(),
    groq: new GroqProvider(),
    cerebras: new CerebrasProvider(),
    google: new GoogleProvider(),
    openrouter: new OpenRouterProvider(),
  };

  const results: BenchmarkResult[] = [];

  // Test each agent's primary model
  console.log('Testing agent models (primary):\n');
  console.log('| Agent | Provider | Model | Available | Latency | Response |');
  console.log('|-------|----------|-------|-----------|---------|----------|');

  for (const [agent, cfg] of Object.entries(AGENT_MODEL_CONFIG)) {
    const provider = providers[cfg.provider as keyof typeof providers];
    if (!provider) continue;

    const result = await testProvider(cfg.provider, provider, cfg.primary);
    result.provider = agent;
    results.push(result);

    const status = result.available ? '✅' : '❌';
    const latency = result.latency ? `${result.latency}ms` : '-';
    const response = result.available ? (result.response?.substring(0, 30) || '-') : '-';
    console.log(`| ${agent} | ${cfg.provider} | ${cfg.primary} | ${status} | ${latency} | ${response} |`);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Detailed Results:');
  console.log('='.repeat(60));

  for (const r of results) {
    console.log(`\n${r.provider} (${r.model}):`);
    console.log(`  Available: ${r.available ? 'YES' : 'NO'}`);
    if (r.latency) console.log(`  Latency: ${r.latency}ms`);
    if (r.response) console.log(`  Response: ${r.response}`);
    if (r.error) console.log(`  Error: ${r.error}`);
  }

  // Test quick math to verify model is actually working
  console.log();
  console.log('='.repeat(60));
  console.log('Verification Test (2+2=?)');
  console.log('='.repeat(60));

  for (const [agent, cfg] of Object.entries(AGENT_MODEL_CONFIG)) {
    if (!cfg.primary.includes('free') && cfg.provider === 'ollama') continue; // Skip non-free for quick test

    const provider = providers[cfg.provider as keyof typeof providers];
    if (!provider?.isAvailable()) continue;

    try {
      const response = await provider.chat({
        model: cfg.primary,
        messages: [VERIFICATION_MESSAGE],
        temperature: 0,
        maxTokens: 10,
        timeout: 15000,
      });

      const isCorrect = /4/.test(response);
      console.log(`  ${agent}: "${response.trim()}" ${isCorrect ? '✅' : '❌'}`);
    } catch (e) {
      console.log(`  ${agent}: ERROR - ${String(e).substring(0, 50)}`);
    }
  }

  console.log();
  console.log('Benchmark complete!');
}

main().catch(console.error);