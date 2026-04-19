import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildDirsearch(args: ToolArgs): string | null {
  const url = args.url || args.target;
  if (!url) return null;

  const parts = ['dirsearch', '-u', url];

  if (args.extensions) parts.push('-e', args.extensions);
  if (args.wordlist) parts.push('-w', args.wordlist);
  if (args.threads) parts.push('-t', String(args.threads));
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const dirsearchTool: ToolDefinition = {
  name: 'dirsearch',
  description: 'Web path scanner - discovers directories and files on web servers',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: [],
  buildCommand: buildDirsearch,
  validateArgs: (args) => {
    if (!args.url && !args.target) return { valid: false, error: 'url or target required' };
    return { valid: true };
  },
};