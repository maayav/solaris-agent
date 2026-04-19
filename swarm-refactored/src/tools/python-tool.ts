import { sharedSandboxManager, type ExecResult } from '../core/sandbox-manager.js';
import type { ToolCall } from '../types/index.js';

export interface PythonExecArgs {
  code?: string;
  script?: string;
  timeout?: number;
}

export async function executePython(args: PythonExecArgs): Promise<ExecResult> {
  const { code, script, timeout = 60 } = args;

  if (script) {
    return sharedSandboxManager.executeScript(script, 'python3', timeout);
  }

  if (!code) {
    return {
      exit_code: 1,
      stdout: '',
      stderr: 'No code or script provided',
      command: 'python exec',
      timed_out: false,
      success: false,
    };
  }

  return sharedSandboxManager.executePython(code, timeout);
}

export async function executePythonToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as PythonExecArgs;
  return executePython({
    code: args.code,
    script: args.script,
    timeout: args.timeout || 60,
  });
}
