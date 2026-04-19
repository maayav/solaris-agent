import { sharedSandboxManager, translateUrlForSandbox, type ExecResult } from '../core/sandbox-manager.js';
import type { ToolCall } from '../types/index.js';

export interface SqlmapArgs {
  url: string;
  method?: 'GET' | 'POST';
  data?: string;
  level?: number;
  risk?: number;
  flags?: string;
}

export async function executeSqlmap(args: SqlmapArgs): Promise<ExecResult> {
  const { url, method = 'GET', data, level = 1, risk = 1, flags = '' } = args;
  
  const translatedUrl = translateUrlForSandbox(url);
  let cmd = `sqlmap -u "${translatedUrl}" --level=${level} --risk=${risk} --batch --json`;

  if (method === 'POST' && data) {
    cmd += ` --data='${data.replace(/'/g, "'\\''")}'`;
  }

  if (flags) {
    cmd += ` ${flags}`;
  }

  return sharedSandboxManager.execCommand(cmd, 300);
}

export async function executeSqlmapQuick(args: SqlmapArgs): Promise<ExecResult> {
  return executeSqlmap({ ...args, level: 1, risk: 1 });
}

export async function executeSqlmapDeep(args: SqlmapArgs): Promise<ExecResult> {
  return executeSqlmap({ ...args, level: 3, risk: 2 });
}

export async function executeSqlmapToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as SqlmapArgs;
  return executeSqlmap({
    url: args.url as string,
    method: args.method,
    data: args.data,
    level: args.level || 1,
    risk: args.risk || 1,
    flags: args.flags,
  });
}

export async function executeSqlmapQuickToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as SqlmapArgs;
  return executeSqlmapQuick({
    url: args.url as string,
    method: args.method,
    data: args.data,
  });
}

export async function executeSqlmapDeepToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as SqlmapArgs;
  return executeSqlmapDeep({
    url: args.url as string,
    method: args.method,
    data: args.data,
  });
}
