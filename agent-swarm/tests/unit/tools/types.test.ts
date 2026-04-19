import { describe, it, expect } from 'vitest';
import type { ToolArgs, ExecResult, ToolDefinition, ToolCategory, AgentRole } from '../../../src/core/tools/types';

describe('tool types', () => {
  describe('ToolArgs', () => {
    it('should accept URL and method for HTTP tools', () => {
      const args: ToolArgs = {
        url: 'http://localhost:3000/api/login',
        method: 'POST',
        data: '{"username":"admin"}',
        timeout: 30000,
      };
      expect(args.url).toBe('http://localhost:3000/api/login');
      expect(args.method).toBe('POST');
      expect(args.data).toBe('{"username":"admin"}');
      expect(args.timeout).toBe(30000);
    });

    it('should accept target and ports for network scanners', () => {
      const args: ToolArgs = {
        target: '10.0.0.1',
        ports: '1-1000',
        flags: '-sV',
      };
      expect(args.target).toBe('10.0.0.1');
      expect(args.ports).toBe('1-1000');
      expect(args.flags).toBe('-sV');
    });

    it('should accept wordlist and threads for fuzzers', () => {
      const args: ToolArgs = {
        url: 'http://localhost:3000/FUZZ',
        wordlist: '/usr/share/wordlists/common.txt',
        threads: 100,
        filters: 'status:200',
      };
      expect(args.wordlist).toBe('/usr/share/wordlists/common.txt');
      expect(args.threads).toBe(100);
    });

    it('should allow arbitrary extra fields', () => {
      const args: ToolArgs = {
        target: '10.0.0.1',
        customField: 'anything',
        anotherField: 42,
      };
      expect((args as any).customField).toBe('anything');
      expect((args as any).anotherField).toBe(42);
    });
  });

  describe('ExecResult', () => {
    it('should represent a successful execution', () => {
      const result: ExecResult = {
        exit_code: 0,
        stdout: '22/tcp open ssh',
        stderr: '',
        command: 'nmap -sV 10.0.0.1',
        timed_out: false,
        success: true,
        duration_ms: 1523,
      };
      expect(result.exit_code).toBe(0);
      expect(result.success).toBe(true);
      expect(result.timed_out).toBe(false);
      expect(result.duration_ms).toBe(1523);
    });

    it('should represent a failed execution', () => {
      const result: ExecResult = {
        exit_code: 1,
        stdout: '',
        stderr: 'nmap: command not found',
        command: 'nmap 10.0.0.1',
        timed_out: false,
        success: false,
        duration_ms: 50,
      };
      expect(result.success).toBe(false);
      expect(result.exit_code).toBe(1);
    });

    it('should represent a timeout', () => {
      const result: ExecResult = {
        exit_code: 124,
        stdout: '',
        stderr: '',
        command: 'nmap -sV 10.0.0.1',
        timed_out: true,
        success: false,
        duration_ms: 30000,
      };
      expect(result.timed_out).toBe(true);
      expect(result.exit_code).toBe(124);
    });
  });

  describe('ToolCategory', () => {
    it('should be one of the valid categories', () => {
      const categories: ToolCategory[] = ['recon', 'exploit', 'privesc', 'enum', 'utility'];
      expect(categories).toContain('recon');
      expect(categories).toContain('exploit');
      expect(categories).toContain('privesc');
      expect(categories).toContain('enum');
      expect(categories).toContain('utility');
    });
  });

  describe('AgentRole', () => {
    it('should be one of the valid roles', () => {
      const roles: AgentRole[] = [
        'alpha', 'gamma', 'mcp', 'osint',
        'post_exploit', 'verifier', 'commander',
      ];
      expect(roles).toContain('alpha');
      expect(roles).toContain('gamma');
      expect(roles).toContain('verifier');
      expect(roles).toContain('commander');
    });
  });

  describe('ToolDefinition', () => {
    it('should require name, description, category, and allowedRoles', () => {
      const tool: ToolDefinition = {
        name: 'nmap',
        description: 'Port and service scanning',
        category: 'recon',
        allowedRoles: ['alpha', 'gamma'],
        buildCommand: (args) => {
          if (!args.target) return null;
          return `nmap ${args.flags || ''} ${args.target}`.trim();
        },
      };
      expect(tool.name).toBe('nmap');
      expect(tool.category).toBe('recon');
      expect(tool.allowedRoles).toContain('alpha');
      expect(tool.allowedRoles).not.toContain('osint');
    });

    it('should support aliases', () => {
      const tool: ToolDefinition = {
        name: 'sqlmap',
        description: 'SQL injection scanner',
        category: 'exploit',
        allowedRoles: ['gamma'],
        aliases: ['sqlmap_quick', 'sqlmap_deep'],
        buildCommand: (args) => args.url ? `sqlmap -u ${args.url}` : null,
      };
      expect(tool.aliases).toContain('sqlmap_quick');
      expect(tool.aliases).toContain('sqlmap_deep');
    });

    it('should support optional validateArgs', () => {
      const tool: ToolDefinition = {
        name: 'curl',
        description: 'HTTP requests',
        category: 'exploit',
        allowedRoles: ['alpha', 'gamma', 'osint', 'verifier'],
        buildCommand: (args) => args.url ? `curl ${args.url}` : null,
        validateArgs: (args) => {
          if (!args.url) return { valid: false, error: 'url required' };
          return { valid: true };
        },
      };
      const valid = tool.validateArgs?.({ url: 'http://example.com' });
      expect(valid?.valid).toBe(true);
      const invalid = tool.validateArgs?.({});
      expect(invalid?.valid).toBe(false);
      expect(invalid?.error).toBe('url required');
    });
  });
});
