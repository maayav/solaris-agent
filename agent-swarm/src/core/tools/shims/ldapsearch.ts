import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildLdapsearch(args: ToolArgs): string | null {
  const server = args.server || args.target;
  if (!server) return null;

  const parts = ['ldapsearch', '-H', `ldap://${server}`];

  if (args.base) parts.push('-b', args.base);
  if (args.dn) parts.push('-D', args.dn);
  if (args.password) parts.push('-w', args.password);
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const ldapsearchTool: ToolDefinition = {
  name: 'ldapsearch',
  description: 'LDAP query tool - enumerate Active Directory users and groups',
  category: 'enum',
  allowedRoles: ['post_exploit'],
  aliases: [],
  buildCommand: buildLdapsearch,
  validateArgs: (args) => {
    if (!args.server && !args.target) return { valid: false, error: 'server or target required' };
    return { valid: true };
  },
};