import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildEcho(args: ToolArgs): string | null {
  const message = args.message || args.data || args.body || '';
  return `echo ${message}`;
}

export const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echo message - outputs text to stdout',
  category: 'utility',
  allowedRoles: ['alpha', 'gamma', 'mcp', 'post_exploit', 'verifier', 'osint', 'commander'],
  aliases: [],
  buildCommand: buildEcho,
  validateArgs: () => ({ valid: true }),
};