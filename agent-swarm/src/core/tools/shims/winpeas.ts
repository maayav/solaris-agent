import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildWinpeas(args: ToolArgs): string | null {
  const parts = ['winpeas.exe'];

  if (args.flags) parts.push(...args.flags.split(' '));
  if (args.target) parts.push(args.target);

  return parts.join(' ');
}

export const winpeasTool: ToolDefinition = {
  name: 'winpeas',
  description: 'Windows privilege escalation checker - automated privesc enumeration',
  category: 'privesc',
  allowedRoles: ['post_exploit'],
  aliases: ['winPEAS'],
  buildCommand: buildWinpeas,
  validateArgs: () => ({ valid: true }),
};