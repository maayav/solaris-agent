import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildNuclei(args: ToolArgs): string | null {
  const target = args.target || args.url;
  if (!target) return null;

  const parts = ['nuclei', '-u', target];

  if (args.templates && args.templates[0]) {
    parts.push('-t', args.templates[0]);
  } else {
    parts.push('-severity', 'critical,high');
  }

  parts.push('-rate-limit', '5');
  parts.push('-timeout', '5');

  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const nucleiTool: ToolDefinition = {
  name: 'nuclei',
  description: 'Vulnerability scanner based on templates - finds CVEs and misconfigs',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma', 'osint'],
  aliases: [],
  buildCommand: buildNuclei,
  validateArgs: (args) => {
    if (!args.target && !args.url) return { valid: false, error: 'target or url required' };
    return { valid: true };
  },
};