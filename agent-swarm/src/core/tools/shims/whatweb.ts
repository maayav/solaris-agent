import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildWhatweb(args: ToolArgs): string | null {
  const url = args.url || args.target;
  if (!url) return null;

  const parts = ['whatweb'];

  if (args.flags) parts.push(...args.flags.split(' '));

  parts.push(url);

  return parts.join(' ');
}

export const whatwebTool: ToolDefinition = {
  name: 'whatweb',
  description: 'Web technology identifier - detects CMS, frameworks, analytics',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: [],
  buildCommand: buildWhatweb,
  validateArgs: (args) => {
    if (!args.url && !args.target) return { valid: false, error: 'url or target required' };
    return { valid: true };
  },
};