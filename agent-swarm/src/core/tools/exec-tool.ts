import { spawn } from 'bun';
import type { ExecResult } from './types.js';

export interface ExecToolOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export async function execTool(
  command: string,
  options: ExecToolOptions = {}
): Promise<ExecResult> {
  const timeout = options.timeout ?? 30000;
  const start = Date.now();

  let timedOut = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let proc: any = null;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    if (proc) {
      proc.kill();
    }
  }, timeout);

  try {
    proc = spawn({
      cmd: ['sh', '-c', command],
      cwd: options.cwd,
      env: options.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    return {
      exit_code: exitCode ?? 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      command,
      timed_out: timedOut,
      success: !timedOut && (exitCode === 0 || exitCode === 1),
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      exit_code: 1,
      stdout: '',
      stderr: String(error),
      command,
      timed_out: timedOut,
      success: false,
      duration_ms: Date.now() - start,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
