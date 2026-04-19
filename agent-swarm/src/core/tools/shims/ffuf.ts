import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildFfuf(args: ToolArgs): string | null {
  const url = args.url || args.target;
  if (!url) return null;

  const parts = ['ffuf', '-u', url];

  if (args.wordlist) parts.push('-w', args.wordlist);
  // Limit threads to prevent PC freeze - hardcode safe defaults
  parts.push('-t', '5');
  parts.push('-silent'); // Quiet output
  if (args.filters) parts.push(...args.filters.split(' '));
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const ffufTool: ToolDefinition = {
  name: 'ffuf',
  description: 'Fast web fuzzer - discovers hidden files and directories',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'], // Re-enabled for Alpha with thread limits
  aliases: [],
  buildCommand: buildFfuf,
  validateArgs: (args) => {
    if (!args.url && !args.target) return { valid: false, error: 'url or target required' };
    return { valid: true };
  },
};