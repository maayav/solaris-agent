import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildRustscan(args: ToolArgs): string | null {
  const target = args.target;
  if (!target) return null;

  const parts = ['rustscan', '-a', target];

  if (args.ports) parts.push('-p', args.ports);
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const rustscanTool: ToolDefinition = {
  name: 'rustscan',
  description: 'Ultra-fast port scanner - designed to scan all ports in seconds',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: [],
  buildCommand: buildRustscan,
  validateArgs: (args) => {
    if (!args.target) return { valid: false, error: 'target required' };
    return { valid: true };
  },
};