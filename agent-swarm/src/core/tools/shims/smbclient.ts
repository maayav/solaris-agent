import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildSmbclient(args: ToolArgs): string | null {
  const target = args.target;
  if (!target) return null;

  const parts = ['smbclient'];

  if (args.share) parts.push('-m', args.share);
  if (args.user) parts.push('-U', args.user);
  if (args.pass) parts.push('-P', args.pass);

  parts.push(target);

  return parts.join(' ');
}

export const smbclientTool: ToolDefinition = {
  name: 'smbclient',
  description: 'SMB/CIFS client - access SMB shares and enumerate files',
  category: 'enum',
  allowedRoles: ['post_exploit'],
  aliases: [],
  buildCommand: buildSmbclient,
  validateArgs: (args) => {
    if (!args.target) return { valid: false, error: 'target required' };
    return { valid: true };
  },
};