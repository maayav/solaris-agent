#!/usr/bin/env bun
import { OpenRouterProvider } from './src/core/providers/openrouter.js';
import { OllamaProvider } from './src/core/providers/ollama.js';

const DELAY_BETWEEN_REQUESTS = 2000;
const REQUEST_TIMEOUT = 90000;

const EXPLOIT_COMMAND_PROMPT = {
  role: 'user',
  content: `Generate an nmap command to scan for open ports on 192.168.1.0/24. Output ONLY valid JSON:
{"command": "nmap -sV -sC -p- -oA 192.168.1.0_scan 192.168.1.0/24", "description": "Full port scan with service detection", "args": ["-sV", "-sC", "-p-", "-oA"]}`,
};

const GOBUSTER_DIR_PROMPT = {
  role: 'user',
  content: `Generate a gobuster dir command to enumerate web directories. Output ONLY valid JSON:
{"command": "gobuster dir -u http://target.local -w /usr/share/wordlists/dirb/common.txt -o gobuster_results.txt", "description": "Directory enumeration", "args": ["dir", "-u", "-w", "-o"]}`,
};

const MISSION_PLAN_PROMPT = {
  role: 'user',
  content: `Create a JSON mission plan: {"mission_id": "test-001", "objectives": [], "phases": [{"name": "", "tools": [], "commands": []}], "expected_duration": "2h"}`,
};

const FINDING_JSON_PROMPT = {
  role: 'user',
  content: `Generate a JSON finding: {"finding_id": "auto-001", "severity": "medium", "title": "SSH Service Detected", "description": "", "evidence": {"port": 22, "service": "ssh", "version": ""}, "recommendations": []}`,
};

const FFUF_COMMAND_PROMPT = {
  role: 'user',
  content: `Generate an ffuf command. Output ONLY valid JSON:
{"command": "ffuf -u 'http://target.local/search?query=FUZZ' -w /usr/share/wordlists/ffuf/parameters.txt -o ffuf_results.json -of json", "description": "Parameter fuzzing", "args": ["-u", "-w", "-o", "-of"]}`,
};

const CODE_REVIEW_PROMPT = {
  role: 'user',
  content: `SQL injection in: <?php $id = $_GET['id']; $query = "SELECT * FROM users WHERE id = $id"; ?>
Output ONLY valid JSON: {"vulnerability": "SQL Injection", "severity": "critical", "location": "line 2", "exploit": "id=1 OR 1=1", "fix": "Use prepared statements"}`,
};

const TEST_CASES = [
  { name: 'exploit_nmap_command', prompt: EXPLOIT_COMMAND_PROMPT },
  { name: 'exploit_gobuster_command', prompt: GOBUSTER_DIR_PROMPT },
  { name: 'exploit_ffuf_command', prompt: FFUF_COMMAND_PROMPT },
  { name: 'mission_plan_json', prompt: MISSION_PLAN_PROMPT },
  { name: 'finding_json', prompt: FINDING_JSON_PROMPT },
  { name: 'code_review_json', prompt: CODE_REVIEW_PROMPT },
];

const REMAINING_MODELS = [
  { name: 'z-ai/glm-4.5-air:free', provider: 'openrouter', instance: new OpenRouterProvider() },
  { name: 'nvidia/nemotron-3-nano-30b-a3b:free', provider: 'openrouter', instance: new OpenRouterProvider() },
  { name: 'phi-3-mini-128k-instruct-q4_K_M', provider: 'ollama', instance: new OllamaProvider() },
  { name: 'llama3-groq-tool-use:8b-q4_K_M', provider: 'ollama', instance: new OllamaProvider() },
  { name: 'qwen2.5-coder:7b-q4_K_M', provider: 'ollama', instance: new OllamaProvider() },
  { name: 'llama-3.1-8b-instant', provider: 'ollama', instance: new OllamaProvider() },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tryParseJson(response: string): { valid: boolean; data?: unknown; error?: string } {
  const trimmed = response.trim();
  let jsonStr = trimmed;
  
  if (trimmed.startsWith('```json')) {
    jsonStr = trimmed.slice(trimmed.indexOf('```json') + 7);
    jsonStr = jsonStr.slice(0, jsonStr.lastIndexOf('```')).trim();
  } else if (trimmed.startsWith('```')) {
    jsonStr = trimmed.slice(trimmed.indexOf('```') + 3);
    jsonStr = jsonStr.slice(0, jsonStr.lastIndexOf('```')).trim();
  }
  
  try {
    return { valid: true, data: JSON.parse(jsonStr) };
  } catch (e) {
    return { valid: false, error: String(e) };
  }
}

function isRateLimitError(error: string): boolean {
  return error.includes('429') || error.includes('rate limit') || error.includes('free-models-per-day') || error.includes('TPM');
}

async function runTest(provider: any, model: string, testCase: any, providerName: string): Promise<any> {
  const result = { model, provider: providerName, testName: testCase.name, latency: 0, response: '', validJson: false, error: '' };
  
  if (!provider.isAvailable()) {
    result.error = 'Provider not available';
    return result;
  }
  
  try {
    const start = Date.now();
    const response = await provider.chat({
      model,
      messages: [testCase.prompt],
      temperature: 0.1,
      maxTokens: 2048,
      timeout: REQUEST_TIMEOUT,
    });
    result.latency = Date.now() - start;
    result.response = response.trim();
    
    const parseResult = tryParseJson(response);
    result.validJson = parseResult.valid;
    if (!parseResult.valid) result.error = parseResult.error;
  } catch (error) {
    result.error = String(error).substring(0, 200);
  }
  
  return result;
}

async function main() {
  console.log('='.repeat(70));
  console.log('REMAINING MODELS BENCHMARK');
  console.log('='.repeat(70));
  console.log(`\nModels: ${REMAINING_MODELS.length}`);
  console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms\n`);
  
  const summaries = [];
  
  for (const modelEntry of REMAINING_MODELS) {
    const results = [];
    const isCloud = modelEntry.provider !== 'ollama';
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Testing: ${modelEntry.name} (${modelEntry.provider.toUpperCase()})`);
    console.log('='.repeat(70));
    
    for (const testCase of TEST_CASES) {
      console.log(`\n  ▶ ${testCase.name}`);
      const result = await runTest(modelEntry.instance, modelEntry.name, testCase, modelEntry.provider);
      results.push(result);
      
      if (result.error && isRateLimitError(result.error)) {
        console.log(`  ⏭️  SKIPPED (rate limit)`);
      } else {
        const status = result.validJson ? '✅' : '❌';
        console.log(`  ${status} ${testCase.name}: ${result.latency || '-'}${result.error ? ` - ${result.error.substring(0, 40)}` : ''}`);
      }
      
      if (isCloud) await sleep(DELAY_BETWEEN_REQUESTS);
    }
    
    const passed = results.filter(r => r.validJson).length;
    const failed = results.filter(r => !r.validJson && !isRateLimitError(r.error)).length;
    const skipped = results.filter(r => isRateLimitError(r.error)).length;
    const avgLatency = results.filter(r => r.latency > 0).reduce((sum, r) => sum + r.latency, 0) / Math.max(1, results.filter(r => r.latency > 0).length);
    const validRate = (passed / Math.max(1, passed + failed)) * 100;
    
    summaries.push({
      model: modelEntry.name,
      provider: modelEntry.provider,
      testsPassed: passed,
      testsFailed: failed,
      avgLatency: Math.round(avgLatency),
      validJsonRate: Math.round(validRate),
      skipped,
      results,
    });
    
    Bun.write('benchmark-remaining.json', JSON.stringify(summaries, null, 2));
    console.log('\n💾 Partial results saved');
  }
  
  console.log('\n\n');
  console.log('='.repeat(70));
  console.log('REMAINING MODELS RESULTS');
  console.log('='.repeat(70));
  
  console.log('\n| Model | Provider | Valid% | Avg Latency | Skipped |');
  console.log('|-------|----------|--------|-------------|---------|');
  
  for (const s of summaries) {
    const stars = s.validJsonRate === 100 ? '⭐' : s.validJsonRate >= 80 ? '✓' : '';
    console.log(`| ${s.model.substring(0, 40).padEnd(40)} | ${s.provider.padEnd(10)} | ${String(s.validJsonRate).padStart(4)}% ${stars} | ${String(s.avgLatency + 'ms').padStart(10)} | ${String(s.skipped).padStart(7)} |`);
  }
  
  console.log('\nBenchmark complete!');
  Bun.write('benchmark-remaining.json', JSON.stringify(summaries, null, 2));
}

main().catch(console.error);
