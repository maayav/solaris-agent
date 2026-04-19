import { sharedSandboxManager, translateUrlForSandbox, type ExecResult } from '../core/sandbox-manager.js';
import type { ToolCall } from '../types/index.js';

export interface FfufArgs {
  url: string;
  wordlist?: string;
  method?: string;
  data?: string;
  filters?: string;
  flags?: string;
}

export async function executeFfuf(args: FfufArgs): Promise<ExecResult> {
  const { url, wordlist = '/usr/share/wordlists/fuzz.txt', method, data, filters, flags } = args;

  const translatedUrl = translateUrlForSandbox(url);
  let cmd = `ffuf -u ${translatedUrl} -w ${wordlist}`;

  if (method) {
    cmd += ` -X ${method}`;
  }

  if (data) {
    cmd += ` -d '${data.replace(/'/g, "'\\''")}'`;
  }

  if (filters) {
    cmd += ` ${filters}`;
  }

  if (flags) {
    cmd += ` ${flags}`;
  }

  cmd += ' -of json -o /tmp/ffuf_results.json';
  const result = await sharedSandboxManager.execCommand(cmd, 180);

  if (result.success) {
    const readResult = await sharedSandboxManager.readFile('/tmp/ffuf_results.json');
    return { ...result, stdout: readResult.stdout };
  }

  return result;
}

export async function executeFfufQuick(args: FfufArgs): Promise<ExecResult> {
  return executeFfuf({
    ...args,
    flags: (args.flags || '') + ' -mc 200,204,301,302,307,401,403,500',
  });
}

export async function executeFfufToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as FfufArgs;
  return executeFfuf({
    url: args.url as string,
    wordlist: args.wordlist,
    method: args.method,
    data: args.data,
    filters: args.filters,
    flags: args.flags,
  });
}

export async function executeFfufQuickToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as FfufArgs;
  return executeFfufQuick({
    url: args.url as string,
    wordlist: args.wordlist,
    method: args.method,
    data: args.data,
    filters: args.filters,
  });
}
