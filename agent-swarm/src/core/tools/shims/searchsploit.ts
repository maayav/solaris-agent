import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildSearchsploit(args: ToolArgs): string | null {
  const query = args.query;
  if (!query) return null;

  const parts = ['searchsploit', query];

  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const searchsploitTool: ToolDefinition = {
  name: 'searchsploit',
  description: 'Exploit database search - find exploits for known vulnerabilities',
  category: 'exploit',
  allowedRoles: ['gamma', 'post_exploit'],
  aliases: [],
  buildCommand: buildSearchsploit,
  validateArgs: (args) => {
    if (!args.query) return { valid: false, error: 'query required' };
    return { valid: true };
  },
};