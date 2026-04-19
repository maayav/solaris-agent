import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildEnum4linux(args: ToolArgs): string | null {
  const target = args.target;
  if (!target) return null;

  const parts = ['enum4linux', target];

  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const enum4linuxTool: ToolDefinition = {
  name: 'enum4linux',
  description: 'SMB/Active Directory enumeration tool - lists users, shares, policies',
  category: 'enum',
  allowedRoles: ['post_exploit'],
  aliases: [],
  buildCommand: buildEnum4linux,
  validateArgs: (args) => {
    if (!args.target) return { valid: false, error: 'target required' };
    return { valid: true };
  },
};