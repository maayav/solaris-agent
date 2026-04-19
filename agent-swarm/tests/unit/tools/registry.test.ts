import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../../src/core/tools/registry';
import type { ToolDefinition, ToolArgs } from '../../../src/core/tools/types';

const mockTool: ToolDefinition = {
  name: 'test-echo',
  description: 'Test tool for echo',
  category: 'utility',
  allowedRoles: ['alpha', 'gamma'],
  aliases: ['echo-test'],
  buildCommand: (args: ToolArgs) => {
    if (!args.message) return null;
    return `echo ${args.message}`;
  },
  validateArgs: (args) => {
    if (!args.message) return { valid: false, error: 'message required' };
    return { valid: true };
  },
};

const mockToolNoArgs: ToolDefinition = {
  name: 'test-true',
  description: 'Returns success',
  category: 'utility',
  allowedRoles: ['alpha'],
  buildCommand: () => 'true',
};

const mockToolFails: ToolDefinition = {
  name: 'test-false',
  description: 'Returns failure',
  category: 'utility',
  allowedRoles: ['alpha'],
  buildCommand: () => 'false',
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('initialization', () => {
    it('should start with no tools before init', () => {
      const tools = registry.listTools();
      expect(tools.length).toBe(0);
    });

    it('should initialize with all tools after init', async () => {
      await registry.initialize();
      const tools = registry.listTools();
      expect(tools.length).toBeGreaterThan(20);
    });
  });

  describe('registerTool', () => {
    it('should register a tool', async () => {
      registry.registerTool(mockTool);
      const tool = registry.getTool('test-echo');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('test-echo');
    });

    it('should register aliases', async () => {
      registry.registerTool(mockTool);
      const alias = registry.getTool('echo-test');
      expect(alias).toBeDefined();
      expect(alias?.name).toBe('test-echo');
    });
  });

  describe('listTools', () => {
    it('should list all registered tools without duplicates', async () => {
      await registry.initialize();
      const tools = registry.listTools();
      const names = tools.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it('should list tools filtered by role', async () => {
      await registry.initialize();
      const alphaTools = registry.listToolsForRole('alpha');
      const gammaTools = registry.listToolsForRole('gamma');
      expect(alphaTools.length).toBeGreaterThan(0);
      expect(gammaTools.length).toBeGreaterThan(0);
    });

    it('should not include tools not allowed for role', async () => {
      await registry.initialize();
      const alphaTools = registry.listToolsForRole('alpha');
      const osintTools = registry.listToolsForRole('osint');
      expect(alphaTools.length).not.toBe(osintTools.length);
    });
  });

  describe('execute', () => {
    it('should execute a registered tool', async () => {
      await registry.initialize();
      const result = await registry.execute('echo', { message: 'hello' });
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toContain('hello');
    });

    it('should return error for unknown tool', async () => {
      await registry.initialize();
      const result = await registry.execute('nonexistent-tool-xyz');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('not found');
    });

    it('should return error when required args missing', async () => {
      registry.registerTool(mockTool);
      const result = await registry.execute('test-echo', {});
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Missing required args');
    });
  });

  describe('executeForRole', () => {
    it('should execute tool for allowed role', async () => {
      await registry.initialize();
      const result = await registry.executeForRole('alpha', 'echo', { message: 'hello' });
      expect(result.success).toBe(true);
    });

    it('should deny tool for unauthorized role', async () => {
      await registry.initialize();
      const result = await registry.executeForRole('osint', 'nmap', { target: '127.0.0.1' });
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('not available');
    });
  });

  describe('getPromptDescriptionForRole', () => {
    it('should return formatted tool list for role', async () => {
      await registry.initialize();
      const desc = registry.getPromptDescriptionForRole('alpha');
      expect(desc).toContain('nmap:');
      expect(desc).toContain('category: recon');
    });
  });
});