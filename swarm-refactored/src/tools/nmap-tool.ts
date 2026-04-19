import { sharedSandboxManager, translateUrlForSandbox, type ExecResult } from '../core/sandbox-manager.js';
import type { ToolCall } from '../types/index.js';

export interface NmapArgs {
  target: string;
  ports?: string;
  flags?: string;
}

export async function executeNmap(args: NmapArgs): Promise<ExecResult> {
  const { target, ports = '22,80,443,3000,8080', flags = '-sV' } = args;
  
  const translatedTarget = translateUrlForSandbox(target);
  const command = `nmap ${flags} -p ${ports} ${translatedTarget}`;
  
  return sharedSandboxManager.execCommand(command, 120);
}

export async function executeNmapToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as NmapArgs;
  return executeNmap({
    target: args.target,
    ports: args.ports,
    flags: args.flags,
  });
}
