import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildCurl(args: ToolArgs): string | null {
  const url = args.url;
  if (!url) return null;

  const parts = ['curl', '-s'];

  if (args.method && args.method !== 'GET') {
    parts.push('-X', args.method);
  }
  if (args.headers) {
    for (const [key, value] of Object.entries(args.headers)) {
      parts.push('-H', `${key}: ${value}`);
    }
  }
  if (args.data) {
    parts.push('-d', args.data);
  } else if (args.body) {
    parts.push('-d', args.body);
  }
  if (args.timeout) {
    parts.push('--max-time', String(Math.floor(args.timeout / 1000)));
  }
  if (args.flags) parts.push(...args.flags.split(' '));

  parts.push(url);

  return parts.join(' ');
}

export const curlTool: ToolDefinition = {
  name: 'curl',
  description: 'HTTP client - send requests, test APIs, fetch content',
  category: 'utility',
  allowedRoles: ['alpha', 'gamma', 'mcp', 'post_exploit', 'verifier', 'osint'],
  aliases: [],
  buildCommand: buildCurl,
  validateArgs: (args) => {
    if (!args.url) return { valid: false, error: 'url required' };
    return { valid: true };
  },
};