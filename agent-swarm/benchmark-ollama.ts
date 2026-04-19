#!/usr/bin/env bun
import { OllamaProvider } from './src/core/providers/ollama.js';

const REQUEST_TIMEOUT = 60000;

const TEST_CASES = [
  {
    name: 'exploit_nmap_command',
    prompt: { role: 'user', content: 'Generate nmap command for 192.168.1.0/24. JSON: {"command": "nmap -sV -sC -p- 192.168.1.0/24", "args": ["-sV"]}' }
  },
  {
    name: 'exploit_gobuster_command',
    prompt: { role: 'user', content: 'Generate gobuster command. JSON: {"command": "gobuster dir -u http://target.local -w wordlist.txt", "args": ["dir"]}' }
  },
  {
    name: 'mission_plan_json',
    prompt: { role: 'user', content: 'JSON mission plan: {"mission_id": "t1", "objectives": [], "phases": [], "expected_duration": "1h"}' }
  },
  {
    name: 'finding_json',
    prompt: { role: 'user', content: 'JSON finding: {"finding_id": "f1", "severity": "medium", "title": "Open Port", "description": ""}' }
  },
  {
    name: 'exploit_ffuf_command',
    prompt: { role: 'user', content: 'Generate ffuf command. JSON: {"command": "ffuf -u http://target.local/FUZZ -w wordlist.txt", "args": ["-u"]}' }
  },
  {
    name: 'code_review_json',
    prompt: { role: 'user', content: 'SQL injection in PHP code. JSON: {"vulnerability": "SQL Injection", "severity": "critical"}' }
  },
];

const OLLAMA_MODELS = [
  'qwen2.5-coder:7b-instruct-q4_K_M',
  'llama3.1:8b-instruct-q4_K_M',
  'phi3:3.8b-mini-128k-instruct-q4_K_M',
];

function tryParseJson(response: string): { valid: boolean; error?: string } {
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
    JSON.parse(jsonStr);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: String(e) };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('OLLAMA MODELS BENCHMARK');
  console.log('='.repeat(70));
  
  const provider = new OllamaProvider();
  
  if (!provider.isAvailable()) {
    console.log('Ollama not available');
    return;
  }
  
  for (const model of OLLAMA_MODELS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Testing: ${model}`);
    console.log('='.repeat(70));
    
    let passed = 0;
    let failed = 0;
    
    for (const testCase of TEST_CASES) {
      try {
        const response = await provider.chat({
          model,
          messages: [testCase.prompt],
          temperature: 0.1,
          maxTokens: 1024,
          timeout: REQUEST_TIMEOUT,
        });
        
        const parseResult = tryParseJson(response);
        const status = parseResult.valid ? '✅' : '❌';
        console.log(`  ${status} ${testCase.name}`);
        if (parseResult.valid) passed++; else failed++;
      } catch (e) {
        console.log(`  ❌ ${testCase.name}: ${String(e).substring(0, 50)}`);
        failed++;
      }
    }
    
    const validRate = Math.round((passed / (passed + failed)) * 100);
    console.log(`\nResult: ${passed}/${passed + failed} passed (${validRate}%)`);
  }
  
  console.log('\n\nBenchmark complete!');
}

main().catch(console.error);
