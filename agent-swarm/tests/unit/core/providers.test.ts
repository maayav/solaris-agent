import { describe, it, expect } from 'vitest';
import { OllamaProvider } from '../../../src/core/providers/ollama';
import { GroqProvider } from '../../../src/core/providers/groq';
import { CerebrasProvider } from '../../../src/core/providers/cerebras';
import { GoogleProvider } from '../../../src/core/providers/google';
import { OpenRouterProvider } from '../../../src/core/providers/openrouter';

const TIMEOUT = 30000;

const TEST_MESSAGE = { role: 'user' as const, content: 'Say "TEST_PASS" and nothing else.' };
const MATH_MESSAGE = { role: 'user' as const, content: 'What is 3+5? Answer with only the number.' };

describe('LLM Providers', () => {
  describe('Groq', () => {
    const provider = new GroqProvider();

    it('should report availability based on API key', () => {
      const available = provider.isAvailable();
      console.log(`Groq available: ${available}`);
    });

    if (provider.isAvailable()) {
      it('should return a response from llama-3.1-8b-instant', async () => {
        const response = await provider.chat({
          model: 'llama-3.1-8b-instant',
          messages: [TEST_MESSAGE],
          temperature: 0.1,
          maxTokens: 50,
          timeout: TIMEOUT,
        });
        expect(response).toContain('TEST_PASS');
      }, TIMEOUT);

      it('should handle math correctly', async () => {
        const response = await provider.chat({
          model: 'llama-3.1-8b-instant',
          messages: [MATH_MESSAGE],
          temperature: 0,
          maxTokens: 10,
          timeout: TIMEOUT,
        });
        const cleanResponse = response.trim();
        expect(cleanResponse).toBe('8');
      }, TIMEOUT);

      it('should benchmark latency', async () => {
        const start = Date.now();
        await provider.chat({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: 0.1,
          maxTokens: 10,
          timeout: TIMEOUT,
        });
        const latency = Date.now() - start;
        console.log(`  Groq (llama-3.1-8b-instant) latency: ${latency}ms`);
        expect(latency).toBeLessThan(TIMEOUT);
      }, TIMEOUT);
    }
  });

  describe('Cerebras', () => {
    const provider = new CerebrasProvider();

    it('should report availability based on API key', () => {
      const available = provider.isAvailable();
      console.log(`Cerebras available: ${available}`);
    });

    if (provider.isAvailable()) {
      it('should return a response from llama-3.1-8b', async () => {
        const response = await provider.chat({
          model: 'llama-3.1-8b',
          messages: [TEST_MESSAGE],
          temperature: 0.1,
          maxTokens: 50,
          timeout: TIMEOUT,
        });
        expect(response).toContain('TEST_PASS');
      }, TIMEOUT);

      it('should return a response from qwen-3-235b-a22b-instruct-2507', async () => {
        const response = await provider.chat({
          model: 'qwen-3-235b-a22b-instruct-2507',
          messages: [TEST_MESSAGE],
          temperature: 0.1,
          maxTokens: 50,
          timeout: TIMEOUT,
        });
        expect(response).toContain('TEST_PASS');
      }, TIMEOUT);

      it('should handle math correctly', async () => {
        const response = await provider.chat({
          model: 'llama-3.1-8b',
          messages: [MATH_MESSAGE],
          temperature: 0,
          maxTokens: 10,
          timeout: TIMEOUT,
        });
        const cleanResponse = response.trim();
        expect(cleanResponse).toBe('8');
      }, TIMEOUT);

      it('should benchmark latency', async () => {
        const start = Date.now();
        await provider.chat({
          model: 'llama-3.1-8b',
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: 0.1,
          maxTokens: 10,
          timeout: TIMEOUT,
        });
        const latency = Date.now() - start;
        console.log(`  Cerebras (llama-3.1-8b) latency: ${latency}ms`);
        expect(latency).toBeLessThan(TIMEOUT);
      }, TIMEOUT);
    }
  });

  describe('Google', () => {
    const provider = new GoogleProvider();

    it('should report availability based on API key', () => {
      const available = provider.isAvailable();
      console.log(`Google available: ${available}`);
    });

    if (provider.isAvailable()) {
      it('should return a response from gemma-3-27b-it', async () => {
        const response = await provider.chat({
          model: 'gemma-3-27b-it',
          messages: [TEST_MESSAGE],
          temperature: 0.1,
          maxTokens: 50,
          timeout: TIMEOUT,
        });
        expect(response).toBeDefined();
        expect(response.length).toBeGreaterThan(0);
      }, TIMEOUT);

      it('should handle math correctly', async () => {
        const response = await provider.chat({
          model: 'gemma-3-27b-it',
          messages: [MATH_MESSAGE],
          temperature: 0,
          maxTokens: 10,
          timeout: TIMEOUT,
        });
        const cleanResponse = response.replace(/[^0-9]/g, '').trim();
        expect(cleanResponse).toBe('8');
      }, TIMEOUT);

      it('should benchmark latency', async () => {
        const start = Date.now();
        await provider.chat({
          model: 'gemma-3-27b-it',
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: 0.1,
          maxTokens: 10,
          timeout: TIMEOUT,
        });
        const latency = Date.now() - start;
        console.log(`  Google (gemma-3-27b-it) latency: ${latency}ms`);
        expect(latency).toBeLessThan(TIMEOUT);
      }, TIMEOUT);
    }
  });

  describe('OpenRouter', () => {
    const provider = new OpenRouterProvider();

    it('should report availability based on API key', () => {
      const available = provider.isAvailable();
      console.log(`OpenRouter available: ${available}`);
    });

    if (provider.isAvailable()) {
      it('should return a response from openai/gpt-oss-120b:free', async () => {
        const response = await provider.chat({
          model: 'openai/gpt-oss-120b:free',
          messages: [TEST_MESSAGE],
          temperature: 0.1,
          maxTokens: 50,
          timeout: TIMEOUT,
        });
        expect(response).toBeDefined();
      }, TIMEOUT);

      it('should benchmark latency', async () => {
        const start = Date.now();
        await provider.chat({
          model: 'openai/gpt-oss-120b:free',
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: 0.1,
          maxTokens: 10,
          timeout: TIMEOUT,
        });
        const latency = Date.now() - start;
        console.log(`  OpenRouter (gpt-oss-120b:free) latency: ${latency}ms`);
        expect(latency).toBeLessThan(TIMEOUT);
      }, TIMEOUT);
    }
  });

  describe('Ollama', () => {
    const provider = new OllamaProvider();

    it('should report availability based on OLLAMA_ENABLED', () => {
      const enabled = process.env.OLLAMA_ENABLED !== 'false';
      const available = provider.isAvailable();
      console.log(`Ollama enabled: ${enabled}, available: ${available}`);
      if (!available) console.log('  (OLLAMA_ENABLED=false or OLLAMA_BASE_URL not reachable)');
    });

    if (provider.isAvailable()) {
      it('should list and test available models', async () => {
        const models = ['llama3.2', 'phi3', 'qwen2.5'];
        let foundWorking = false;
        
        for (const model of models) {
          try {
            const response = await provider.chat({
              model,
              messages: [{ role: 'user', content: 'Hi' }],
              temperature: 0.1,
              maxTokens: 10,
              timeout: 5000,
            });
            if (response) {
              console.log(`  Ollama (${model}) works!`);
              foundWorking = true;
              break;
            }
          } catch (e) {
            console.log(`  Ollama (${model}): ${e.message.includes('not found') ? 'not downloaded' : 'error'}`);
          }
        }
        
        if (!foundWorking) {
          console.log('  No working Ollama model found - run: ollama pull <model>');
        }
      }, 20000);
    }
  });
});

describe('AGENT_MODEL_CONFIG validation', () => {
  it('should have valid configuration for all agents', () => {
    const { AGENT_MODEL_CONFIG } = require('../../../src/core/models');
    
    for (const [agent, config] of Object.entries(AGENT_MODEL_CONFIG)) {
      expect(config.provider).toBeDefined();
      expect(config.primary).toBeDefined();
      expect(config.fallback).toBeDefined();
      console.log(`${agent}: ${config.provider}/${config.primary}`);
    }
  });
});