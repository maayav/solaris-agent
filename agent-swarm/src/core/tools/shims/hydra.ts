import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildHydra(args: ToolArgs): string | null {
  const target = args.target;
  const service = args.service;
  if (!target || !service) return null;

  const parts = ['hydra', '-l', args.user || 'admin', '-p', args.pass || 'password', target, service];

  if (args.wordlist) parts.push('-P', args.wordlist);
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const hydraTool: ToolDefinition = {
  name: 'hydra',
  description: 'Network authentication cracker - brute force login attacks',
  category: 'privesc',
  allowedRoles: ['gamma', 'post_exploit'],
  aliases: [],
  buildCommand: buildHydra,
  validateArgs: (args) => {
    if (!args.target) return { valid: false, error: 'target required' };
    if (!args.service) return { valid: false, error: 'service required' };
    return { valid: true };
  },
};