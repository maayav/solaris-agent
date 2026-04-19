import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildNmap(args: ToolArgs): string | null {
  const target = args.target || args.url;
  if (!target) return null;

  const parts = ['nmap'];

  if (args.flags) parts.push(args.flags);
  if (args.ports) parts.push('-p', args.ports);
  if (args.rate) parts.push('--rate', String(args.rate));

  parts.push(target);

  return parts.join(' ');
}

export const nmapTool: ToolDefinition = {
  name: 'nmap',
  description: 'Port and service scanning - detects open ports and service versions',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: [],
  buildCommand: buildNmap,
  validateArgs: (args) => {
    if (!args.target && !args.url) return { valid: false, error: 'target or url required' };
    return { valid: true };
  },
};