import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildHashcat(args: ToolArgs): string | null {
  const hashFile = args.hash_file;
  if (!hashFile) return null;

  const parts = ['hashcat', '-m', '0', hashFile];

  if (args.mode) parts.push('-m', String(args.mode));
  if (args.wordlist) parts.push(args.wordlist);
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const hashcatTool: ToolDefinition = {
  name: 'hashcat',
  description: 'GPU-accelerated password cracker - fast hash cracking',
  category: 'privesc',
  allowedRoles: ['post_exploit'],
  aliases: [],
  buildCommand: buildHashcat,
  validateArgs: (args) => {
    if (!args.hash_file) return { valid: false, error: 'hash_file required' };
    return { valid: true };
  },
};