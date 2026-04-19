import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildLinpeas(args: ToolArgs): string | null {
  const parts = ['linpeas.sh'];

  if (args.flags) parts.push(...args.flags.split(' '));
  if (args.target) parts.push(args.target);

  return parts.join(' ');
}

export const linpeasTool: ToolDefinition = {
  name: 'linpeas',
  description: 'Linux privilege escalation checker - automated privesc enumeration',
  category: 'privesc',
  allowedRoles: ['post_exploit'],
  aliases: ['linPEAS'],
  buildCommand: buildLinpeas,
  validateArgs: () => ({ valid: true }),
};