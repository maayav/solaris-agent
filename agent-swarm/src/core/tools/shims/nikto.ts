import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildNikto(args: ToolArgs): string | null {
  const url = args.url || args.target;
  if (!url) return null;

  const parts = ['nikto', '-h', url];

  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const niktoTool: ToolDefinition = {
  name: 'nikto',
  description: 'Web server scanner - finds vulnerabilities and misconfigurations',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: [],
  buildCommand: buildNikto,
  validateArgs: (args) => {
    if (!args.url && !args.target) return { valid: false, error: 'url or target required' };
    return { valid: true };
  },
};