import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildMasscan(args: ToolArgs): string | null {
  const target = args.target;
  if (!target) return null;

  const parts = ['masscan'];

  if (args.ports) parts.push('-p', args.ports);
  if (args.rate) parts.push('--rate', String(args.rate));

  parts.push(target);

  return parts.join(' ');
}

export const masscanTool: ToolDefinition = {
  name: 'masscan',
  description: 'Fast TCP port scanner - scans entire Internet in minutes',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: [],
  buildCommand: buildMasscan,
  validateArgs: (args) => {
    if (!args.target) return { valid: false, error: 'target required' };
    return { valid: true };
  },
};