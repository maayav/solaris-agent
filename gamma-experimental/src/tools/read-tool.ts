import fs from 'fs';
import path from 'path';

const MAX_LINE_LENGTH = 2000;
const DEFAULT_LIMIT = 2000;

export interface ReadToolParams {
  filePath: string;
  offset?: number;
  limit?: number;
}

export interface ReadToolResult {
  output: string;
  truncated: boolean;
  totalLines?: number;
  linesRead?: number;
}

export function readTool(params: ReadToolParams): ReadToolResult {
  const { filePath, offset = 0, limit = DEFAULT_LIMIT } = params;

  if (!fs.existsSync(filePath)) {
    return {
      output: `<error>File not found: ${filePath}</error>`,
      truncated: false,
    };
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(filePath, { withFileTypes: true });
    const lines = entries.map((e) => {
      const prefix = e.isDirectory() ? 'd' : '-';
      return `${prefix} ${e.name}`;
    });
    return {
      output: `<dir>\n${lines.join('\n')}\n</dir>`,
      truncated: false,
      totalLines: lines.length,
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const allLines = content.split('\n');
  const totalLines = allLines.length;

  const start = Math.max(0, offset);
  const end = Math.min(allLines.length, offset + limit);
  const selectedLines = allLines.slice(start, end);

  const truncated = selectedLines.some((line) => line.length > MAX_LINE_LENGTH);
  const processedLines = selectedLines.map((line) =>
    line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + '...' : line
  );

  return {
    output: `<file path="${filePath}" lines="${start + 1}-${end}/${totalLines}">\n${processedLines.join('\n')}\n</file>`,
    truncated,
    totalLines,
    linesRead: end - start,
  };
}

export function listMissionFiles(missionDir: string, pattern?: string): string[] {
  if (!fs.existsSync(missionDir)) return [];

  const files: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        if (pattern) {
          if (entry.name.includes(pattern) || fullPath.includes(pattern)) {
            files.push(fullPath);
          }
        } else {
          files.push(fullPath);
        }
      }
    }
  }

  walk(missionDir);
  return files.sort((a, b) => {
    const statA = fs.statSync(a);
    const statB = fs.statSync(b);
    return statB.mtimeMs - statA.mtimeMs;
  });
}
