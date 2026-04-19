import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildWget(args: ToolArgs): string | null {
  const url = args.url;
  if (!url) return null;

  const parts = ['wget', '-q'];

  if (args.output) parts.push('-O', args.output);
  if (args.flags) parts.push(...args.flags.split(' '));

  parts.push(url);

  return parts.join(' ');
}

export const wgetTool: ToolDefinition = {
  name: 'wget',
  description: 'Non-interactive file downloader - fetch files from web/ftp',
  category: 'utility',
  allowedRoles: ['alpha', 'gamma', 'post_exploit'],
  aliases: [],
  buildCommand: buildWget,
  validateArgs: (args) => {
    if (!args.url) return { valid: false, error: 'url required' };
    return { valid: true };
  },
};