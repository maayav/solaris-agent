import type { ToolCall, ExecResult } from '../types/index.js';
import { executeCurlToolCall } from '../tools/curl-tool.js';
import { executeNmapToolCall } from '../tools/nmap-tool.js';
import { executeNucleiToolCall } from '../tools/nuclei-tool.js';
import { executeSqlmapToolCall, executeSqlmapQuickToolCall, executeSqlmapDeepToolCall } from '../tools/sqlmap-tool.js';
import { executeFfufToolCall, executeFfufQuickToolCall } from '../tools/ffuf-tool.js';
import { executeJwtToolCall } from '../tools/jwt-tool.js';
import { executeWebSearchToolCall } from '../tools/web-search-tool.js';
import { executePythonToolCall } from '../tools/python-tool.js';

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'recon' | 'exploit' | 'utility';
  aliases?: string[];
  execute: (args: ToolArgs) => Promise<ExecResult>;
  validateArgs?: (args: ToolArgs) => ValidationResult;
}

export interface ToolArgs {
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  data?: string;
  command?: string;
  script?: string;
  code?: string;
  timeout?: number;
  target?: string;
  ports?: string;
  flags?: string;
  templates?: string[];
  severity?: string[];
  level?: number;
  risk?: number;
  wordlist?: string;
  filters?: string;
  action?: 'exploit' | 'forge' | 'google' | 'shodan' | 'cve' | 'scrape';
  token?: string;
  secret?: string;
  payload?: Record<string, unknown>;
  query?: string;
  limit?: number;
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.registerTool({
      name: 'curl',
      description: 'HTTP request tool - sends custom HTTP requests with any method, headers, and body',
      category: 'exploit',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'curl',
          args: {
            url: args.url || '',
            method: args.method || 'GET',
            headers: args.headers || {},
            data: args.data,
            timeout: args.timeout || 30,
          },
          exploit_type: 'curl' as ToolCall['exploit_type'],
        };
        return executeCurlToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.url) {
          return { valid: false, error: 'url is required for curl' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'python',
      description: 'Execute Python code in sandbox - has requests library available',
      category: 'exploit',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'python',
          args: {
            code: args.code,
            script: args.script,
            timeout: args.timeout || 60,
          },
          exploit_type: 'python' as ToolCall['exploit_type'],
        };
        return executePythonToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.code && !args.script) {
          return { valid: false, error: 'code or script is required for python' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'nmap',
      description: 'Port scanning and service detection - automatically scans specific ports for efficiency',
      category: 'recon',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'nmap',
          args: {
            target: args.target || args.url || '',
            ports: args.ports,
            flags: args.flags,
          },
          exploit_type: 'nmap' as ToolCall['exploit_type'],
        };
        return executeNmapToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.target && !args.url) {
          return { valid: false, error: 'target or url is required for nmap' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'nuclei',
      description: 'Vulnerability scanner using community templates - detects CVEs, misconfigs, SQLi, XSS',
      category: 'recon',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'nuclei',
          args: {
            target: args.target || args.url || '',
            templates: args.templates,
            severity: args.severity,
          },
          exploit_type: 'nuclei' as ToolCall['exploit_type'],
        };
        return executeNucleiToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.target && !args.url) {
          return { valid: false, error: 'target or url is required for nuclei' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'sqlmap',
      description: 'Automated SQL injection scanner - fingerprinting, data extraction, WAF bypass',
      category: 'exploit',
      aliases: ['sqlmap_quick', 'sqlmap_deep'],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'sqlmap',
          args: {
            url: args.url || '',
            method: args.method,
            data: args.data,
            level: args.level || 1,
            risk: args.risk || 1,
            flags: args.flags,
          },
          exploit_type: 'sqli' as ToolCall['exploit_type'],
        };
        return executeSqlmapToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.url) {
          return { valid: false, error: 'url is required for sqlmap' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'sqlmap_quick',
      description: 'Quick SQL injection test (level 1, risk 1)',
      category: 'exploit',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'sqlmap_quick',
          args: {
            url: args.url || '',
            method: args.method,
            data: args.data,
          },
          exploit_type: 'sqli' as ToolCall['exploit_type'],
        };
        return executeSqlmapQuickToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.url) {
          return { valid: false, error: 'url is required for sqlmap_quick' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'sqlmap_deep',
      description: 'Deep SQL injection scan (level 3, risk 2, enumerates tables)',
      category: 'exploit',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'sqlmap_deep',
          args: {
            url: args.url || '',
            method: args.method,
            data: args.data,
          },
          exploit_type: 'sqli' as ToolCall['exploit_type'],
        };
        return executeSqlmapDeepToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.url) {
          return { valid: false, error: 'url is required for sqlmap_deep' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'ffuf',
      description: 'Fast web fuzzer for directory and API endpoint discovery',
      category: 'recon',
      aliases: ['ffuf_quick'],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'ffuf',
          args: {
            url: args.url || '',
            wordlist: args.wordlist,
            method: args.method,
            data: args.data,
            filters: args.filters,
            flags: args.flags,
          },
          exploit_type: 'ffuf' as ToolCall['exploit_type'],
        };
        return executeFfufToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.url) {
          return { valid: false, error: 'url is required for ffuf' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'ffuf_quick',
      description: 'Quick directory scan with default wordlist and 404 filtering',
      category: 'recon',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'ffuf_quick',
          args: {
            url: args.url || '',
            wordlist: args.wordlist,
            method: args.method,
            data: args.data,
            filters: args.filters,
          },
          exploit_type: 'ffuf' as ToolCall['exploit_type'],
        };
        return executeFfufQuickToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.url) {
          return { valid: false, error: 'url is required for ffuf_quick' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'jwt_exploit',
      description: 'Tests JWT vulnerabilities: alg:none bypass, algorithm confusion, weak secret brute force',
      category: 'exploit',
      aliases: ['jwt_forge'],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'jwt_exploit',
          args: {
            action: 'exploit',
            token: args.token,
            secret: args.secret,
          },
          exploit_type: 'jwt' as ToolCall['exploit_type'],
        };
        return executeJwtToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.token) {
          return { valid: false, error: 'token is required for jwt_exploit' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'jwt_forge',
      description: 'Forges JWT tokens with custom claims and signing',
      category: 'exploit',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'jwt_forge',
          args: {
            action: 'forge',
            secret: args.secret,
            payload: args.payload,
          },
          exploit_type: 'jwt' as ToolCall['exploit_type'],
        };
        return executeJwtToolCall(toolCall);
      },
      validateArgs: (): ValidationResult => {
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'google_search',
      description: 'Google search via Serper.dev API for OSINT',
      category: 'utility',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'google_search',
          args: {
            action: 'google',
            query: args.query,
            limit: args.limit || 10,
          },
          exploit_type: 'osint' as ToolCall['exploit_type'],
        };
        return executeWebSearchToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.query) {
          return { valid: false, error: 'query is required for google_search' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'shodan_search',
      description: 'Search Shodan for exposed services and vulnerabilities',
      category: 'utility',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'shodan_search',
          args: {
            action: 'shodan',
            query: args.query,
            limit: args.limit || 10,
          },
          exploit_type: 'osint' as ToolCall['exploit_type'],
        };
        return executeWebSearchToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.query) {
          return { valid: false, error: 'query is required for shodan_search' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'search_cve',
      description: 'Search CVE database via NVD API',
      category: 'utility',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'search_cve',
          args: {
            action: 'cve',
            query: args.query,
            limit: args.limit || 10,
          },
          exploit_type: 'cve' as ToolCall['exploit_type'],
        };
        return executeWebSearchToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.query) {
          return { valid: false, error: 'query is required for search_cve' };
        }
        return { valid: true };
      },
    });

    this.registerTool({
      name: 'scrape_website',
      description: 'Scrapes website content - extracts forms, links, tech stack, emails',
      category: 'utility',
      aliases: [],
      execute: async (args: ToolArgs): Promise<ExecResult> => {
        const toolCall: ToolCall = {
          tool: 'scrape_website',
          args: {
            action: 'scrape',
            target: args.target || args.url,
          },
          exploit_type: 'scrape' as ToolCall['exploit_type'],
        };
        return executeWebSearchToolCall(toolCall);
      },
      validateArgs: (args: ToolArgs): ValidationResult => {
        if (!args.target && !args.url) {
          return { valid: false, error: 'target or url is required for scrape_website' };
        }
        return { valid: true };
      },
    });

    this.initialized = true;
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    if (tool.aliases) {
      for (const alias of tool.aliases) {
        this.tools.set(alias, tool);
      }
    }
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolDefinition[] {
    const seen = new Set<string>();
    return Array.from(this.tools.values()).filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
  }

  listToolsByCategory(category: 'recon' | 'exploit' | 'utility'): ToolDefinition[] {
    return this.listTools().filter((t) => t.category === category);
  }

  async execute(name: string, args: ToolArgs): Promise<ExecResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        exit_code: 1,
        stdout: '',
        stderr: `Tool '${name}' not found`,
        command: name,
        timed_out: false,
        success: false,
      };
    }

    if (tool.validateArgs) {
      const validation = tool.validateArgs(args);
      if (!validation.valid) {
        return {
          exit_code: 1,
          stdout: '',
          stderr: validation.error || 'Invalid arguments',
          command: name,
          timed_out: false,
          success: false,
        };
      }
    }

    try {
      return await tool.execute(args);
    } catch (error) {
      return {
        exit_code: 1,
        stdout: '',
        stderr: String(error),
        command: name,
        timed_out: false,
        success: false,
      };
    }
  }

  getPromptDescription(): string {
    const tools = this.listTools();
    return tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description} (category: ${t.category})`
      )
      .join('\n');
  }
}

export const toolRegistry = new ToolRegistry();
