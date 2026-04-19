import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildJohn(args: ToolArgs): string | null {
  const hashFile = args.hash_file;
  if (!hashFile) return null;

  const parts = ['john', hashFile];

  if (args.wordlist) parts.push('--wordlist', args.wordlist);
  if (args.flags) parts.push(...args.flags.split(' '));

  return parts.join(' ');
}

export const johnTool: ToolDefinition = {
  name: 'john',
  description: 'Password cracker - hash cracking with wordlists and rules',
  category: 'privesc',
  allowedRoles: ['post_exploit'],
  aliases: ['john-the-ripper'],
  buildCommand: buildJohn,
  validateArgs: (args) => {
    if (!args.hash_file) return { valid: false, error: 'hash_file required' };
    return { valid: true };
  },
};