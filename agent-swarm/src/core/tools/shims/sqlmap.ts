import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildSqlmap(args: ToolArgs): string | null {
  const url = args.url;
  if (!url) return null;

  const parts = ['sqlmap', '-u', url];

  if (args.data) parts.push('--data', args.data);
  if (args.level) parts.push('--level', String(args.level));
  if (args.risk) parts.push('--risk', String(args.risk));
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const sqlmapTool: ToolDefinition = {
  name: 'sqlmap',
  description: 'SQL injection detector and exploit tool',
  category: 'exploit',
  allowedRoles: ['gamma'],
  aliases: [],
  buildCommand: buildSqlmap,
  validateArgs: (args) => {
    if (!args.url) return { valid: false, error: 'url required' };
    return { valid: true };
  },
};