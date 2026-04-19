import { describe, it, expect, beforeEach } from 'vitest';
import { execTool, type ExecToolOptions } from '../../../src/core/tools/exec-tool';
import { exec } from 'bun';

describe('execTool', () => {
  it('should execute a simple command and return stdout', async () => {
    const result = await execTool('echo hello');
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.timed_out).toBe(false);
    expect(result.success).toBe(true);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should capture stderr from a failed command', async () => {
    const result = await execTool('ls /nonexistent-path-xyz');
    expect(result.exit_code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('No such file');
    expect(result.success).toBe(false);
  });

  it('should parse command string into args', async () => {
    const result = await execTool('echo hello world from test');
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe('hello world from test');
    expect(result.command).toBe('echo hello world from test');
  });

  it('should respect timeout option', async () => {
    const result = await execTool('sleep 5', { timeout: 500 });
    expect(result.timed_out).toBe(true);
    expect(result.success).toBe(false);
    expect(result.duration_ms).toBeGreaterThanOrEqual(500);
  });

  it('should use default timeout of 30000ms', async () => {
    const result = await execTool('echo quick');
    expect(result.timed_out).toBe(false);
    expect(result.duration_ms).toBeLessThan(30000);
  });

  it('should handle commands with special characters', async () => {
    const result = await execTool('printf "line1\\nline2\\n"');
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('line1');
    expect(result.stdout).toContain('line2');
  });

  it('should return exit code from command', async () => {
    const result = await execTool('exit 42');
    expect(result.exit_code).toBe(42);
    expect(result.success).toBe(false);
  });

  it('should handle commands with pipes', async () => {
    const result = await execTool('echo "test" | cat');
    expect(result.exit_code).toBe(0);
    expect(result.stdout.trim()).toBe('test');
  });

  it('should track duration_ms accurately', async () => {
    const start = Date.now();
    const result = await execTool('echo instant');
    const elapsed = Date.now() - start;
    expect(result.duration_ms).toBeLessThanOrEqual(elapsed + 10);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should handle commands that produce no output', async () => {
    const result = await execTool('true');
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.success).toBe(true);
  });

  it('should support custom cwd option', async () => {
    const result = await execTool('pwd', { cwd: '/tmp' });
    expect(result.exit_code).toBe(0);
    expect(result.stdout.trim()).toBe('/tmp');
  });

  it('should include the command in ExecResult', async () => {
    const result = await execTool('echo test');
    expect(result.command).toBe('echo test');
  });
});
