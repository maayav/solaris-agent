import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildNetcat(args: ToolArgs): string | null {
  const target = args.target;
  const port = args.port || args.ports;
  if (!target || !port) return null;

  const parts = ['nc'];

  if (args.flags) parts.push(...args.flags.split(' '));

  parts.push(target, String(port));

  return parts.flat().join(' ');
}

export const netcatTool: ToolDefinition = {
  name: 'netcat',
  description: 'Network Swiss Army knife - read/write TCP/UDP connections',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: ['nc'],
  buildCommand: buildNetcat,
  validateArgs: (args) => {
    if (!args.target) return { valid: false, error: 'target required' };
    if (!args.port && !args.ports) return { valid: false, error: 'port required' };
    return { valid: true };
  },
};