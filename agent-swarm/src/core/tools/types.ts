export interface ToolArgs {
  target?: string;
  url?: string;
  host?: string;
  port?: number | string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  data?: string;
  body?: string;
  ports?: string;
  rate?: number;
  flags?: string;
  wordlist?: string;
  extensions?: string;
  threads?: number;
  filters?: string;
  user?: string;
  pass?: string;
  hash_file?: string;
  service?: string;
  level?: number;
  risk?: number;
  payload?: string;
  output?: string;
  query?: string;
  timeout?: number;
  templates?: string[];
  severity?: string[];
  share?: string;
  mode?: number;
  upload?: boolean;
  base?: string;
  dn?: string;
  password?: string;
  module?: string;
  command?: string;
  batch_size?: number;
  [key: string]: unknown;
}

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  command: string;
  timed_out: boolean;
  success: boolean;
  duration_ms: number;
}

export type ToolCategory = 'recon' | 'exploit' | 'privesc' | 'enum' | 'utility';

export type AgentRole =
  | 'alpha' | 'gamma' | 'mcp' | 'osint'
  | 'post_exploit' | 'verifier' | 'commander';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  allowedRoles: AgentRole[];
  aliases?: string[];
  buildCommand(args: ToolArgs): string | null;
  validateArgs?: (args: ToolArgs) => { valid: boolean; error?: string };
}
