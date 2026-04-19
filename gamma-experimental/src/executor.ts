import { exec } from 'child_process';
import { promisify } from 'util';
import type { CommandResult } from './types.js';

const execAsync = promisify(exec);

export class Executor {
  private timeout: number;

  constructor(timeoutMs = 30000) {
    this.timeout = timeoutMs;
  }

  async run(command: string): Promise<CommandResult> {
    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      const duration = Date.now() - start;
      return {
        command,
        stdout: stdout || '',
        stderr: stderr || '',
        exit_code: 0,
        timed_out: false,
        success: true,
      };
    } catch (error: unknown) {
      const err = error as { code?: number; stderr?: string; stdout?: string; killed?: boolean };
      const duration = Date.now() - start;
      if (err.killed) {
        return {
          command,
          stdout: '',
          stderr: 'Command timed out',
          exit_code: 124,
          timed_out: true,
          success: false,
        };
      }
      return {
        command,
        stdout: err.stdout || '',
        stderr: err.stderr || String(error),
        exit_code: err.code ?? -1,
        timed_out: false,
        success: false,
      };
    }
  }
}
