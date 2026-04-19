import { sharedSandboxManager, translateUrlForSandbox, type ExecResult } from '../core/sandbox-manager.js';
import type { ToolCall } from '../types/index.js';

export interface NucleiArgs {
  target: string;
  templates?: string[];
  severity?: string[];
  flags?: string;
}

export async function executeNuclei(args: NucleiArgs): Promise<ExecResult> {
  const { target, templates, severity, flags } = args;
  
  const translatedTarget = translateUrlForSandbox(target);
  let cmd = `nuclei -u ${translatedTarget} -json-export -`;

  if (templates && templates.length > 0) {
    cmd += ` -t ${templates.join(',')}`;
  }

  if (severity && severity.length > 0) {
    cmd += ` -severity ${severity.join(',')}`;
  }

  if (flags) {
    cmd += ` ${flags}`;
  }

  return sharedSandboxManager.execCommand(cmd, 180);
}

export async function executeNucleiToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as NucleiArgs;
  return executeNuclei({
    target: args.target,
    templates: args.templates,
    severity: args.severity,
    flags: args.flags,
  });
}
