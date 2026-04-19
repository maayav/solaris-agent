import { describe, it, expect } from 'vitest';
import { AGENT_MODEL_CONFIG, type AgentModelConfig } from '../../../src/core/models';

describe('AGENT_MODEL_CONFIG', () => {
  it('should have all 12 agent types', () => {
    const expected = [
      'verifier', 'critic', 'gamma', 'alpha', 'mcp', 'specialist',
      'post_exploit', 'commander', 'mission_planner', 'chain_planner', 'osint', 'report_agent'
    ];
    const actual = Object.keys(AGENT_MODEL_CONFIG).sort();
    expect(actual).toEqual(expected.sort());
  });

  it('should have valid provider for each agent', () => {
    const validProviders = ['ollama', 'groq', 'cerebras', 'openrouter', 'anthropic', 'google'];
    for (const [agent, config] of Object.entries(AGENT_MODEL_CONFIG)) {
      expect(validProviders).toContain(config.provider);
    }
  });

  it('should have temperature between 0 and 1.5', () => {
    for (const config of Object.values(AGENT_MODEL_CONFIG)) {
      expect(config.temperature).toBeGreaterThanOrEqual(0);
      expect(config.temperature).toBeLessThanOrEqual(1.5);
    }
  });

  it('should have maxTokens defined for all agents', () => {
    for (const [agent, config] of Object.entries(AGENT_MODEL_CONFIG)) {
      expect(config.maxTokens).toBeDefined();
      expect(config.maxTokens).toBeGreaterThan(0);
    }
  });

  it('should have primary and fallback models', () => {
    for (const config of Object.values(AGENT_MODEL_CONFIG)) {
      expect(typeof config.primary).toBe('string');
      expect(config.primary.length).toBeGreaterThan(0);
      expect(typeof config.fallback).toBe('string');
      expect(config.fallback.length).toBeGreaterThan(0);
    }
  });

  it('should export AgentModelConfig type', () => {
    const config: AgentModelConfig = {
      primary: 'test-model',
      fallback: 'test-fallback',
      temperature: 0.5,
      maxTokens: 1024,
      provider: 'ollama',
    };
    expect(config.primary).toBe('test-model');
  });
});