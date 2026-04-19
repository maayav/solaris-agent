import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildGobuster(args: ToolArgs): string | null {
  const url = args.url || args.target;
  if (!url) return null;

  const parts = ['gobuster', 'dir', '-u', url];

  if (args.wordlist) parts.push('-w', args.wordlist);
  if (args.threads) parts.push('-t', String(args.threads));
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const gobusterTool: ToolDefinition = {
  name: 'gobuster',
  description: 'Directory/file and DNS busting tool - discovers hidden paths',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: [],
  buildCommand: buildGobuster,
  validateArgs: (args) => {
    if (!args.url && !args.target) return { valid: false, error: 'url or target required' };
    return { valid: true };
  },
};