import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildMsfconsole(args: ToolArgs): string | null {
  const parts = ['msfconsole', '-q'];

  if (args.target) parts.push('--workspace', args.target);
  if (args.module) parts.push('-m', args.module);
  if (args.command) {
    parts.push('-x', args.command);
  } else if (args.flags) {
    parts.push(...args.flags.split(' '));
  }

  return parts.join(' ');
}

export const msfconsoleTool: ToolDefinition = {
  name: 'msfconsole',
  description: 'Metasploit framework - exploit development and execution',
  category: 'exploit',
  allowedRoles: ['gamma', 'post_exploit'],
  aliases: ['msf'],
  buildCommand: buildMsfconsole,
  validateArgs: () => ({ valid: true }),
};