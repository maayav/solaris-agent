import { sharedSandboxManager, translateUrlForSandbox, type ExecResult } from '../core/sandbox-manager.js';
import type { ToolCall } from '../types/index.js';

export interface CurlArgs {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
}

export async function executeCurl(args: CurlArgs): Promise<ExecResult> {
  const { url, method = 'GET', headers = {}, data, timeout = 30 } = args;

  let cmd = `curl -s -w "\\n%{http_code}"`;

  for (const [key, value] of Object.entries(headers)) {
    cmd += ` -H '${key}: ${value.replace(/'/g, "'\\''")}'`;
  }

  if (method !== 'GET' && data) {
    cmd += ` -X ${method} -d '${data.replace(/'/g, "'\\''")}'`;
  } else if (method !== 'GET') {
    cmd += ` -X ${method}`;
  }

  const translatedUrl = translateUrlForSandbox(url);
  cmd += ` "${translatedUrl}"`;

  return sharedSandboxManager.execCommand(cmd, timeout);
}

export async function executeCurlToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as CurlArgs;
  return executeCurl({
    url: args.url,
    method: args.method,
    headers: args.headers,
    data: args.data,
    timeout: args.timeout || 30,
  });
}
