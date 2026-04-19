#!/usr/bin/env bun
import { readdirSync, statSync, lstatSync, readlinkSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, extname } from 'path';

const WORDLISTS_DIR = join(__dirname, '..', 'wordlists');
const OUTPUT_FILE = join(__dirname, '..', 'wordlists', 'INDEX.json');

interface WordlistEntry {
  path: string;
  lines: number;
  size: number;
  source: string;
  type: string;
}

interface IndexData {
  generated_at: string;
  total_wordlists: number;
  stages: Record<string, Record<string, WordlistEntry | Record<string, WordlistEntry>>>;
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

function detectSource(filePath: string): string {
  try {
    const lstat = lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
      const linkTarget = readlinkSync(filePath);
      if (linkTarget.includes('SecLists')) return 'SecLists';
      if (linkTarget.includes('PayloadsAllTheThings')) return 'PayloadsAllTheThings';
    }
    if (filePath.includes('SecLists')) return 'SecLists';
    if (filePath.includes('PayloadsAllTheThings')) return 'PayloadsAllTheThings';
  } catch {}
  return 'unknown';
}

function detectType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (['.md', '.txt'].includes(ext)) return 'text';
  if (['.json'].includes(ext)) return 'json';
  return 'text';
}

function walkDir(dir: string, stage: string): Record<string, WordlistEntry> {
  const entries: Record<string, WordlistEntry> = {};

  try {
    const items = readdirSync(dir);

    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        const subEntries = walkDir(fullPath, `${stage}/${item}`);
        Object.assign(entries, subEntries);
      } else {
        const isSymlink = lstatSync(fullPath).isSymbolicLink();
        if (isSymlink || stat.isFile()) {
          const relativePath = relative(WORDLISTS_DIR, fullPath);
          const lines = countLines(fullPath);
          const source = detectSource(fullPath);
          const type = detectType(item);

          entries[item.replace(/\.[^.]+$/, '')] = {
            path: relativePath,
            lines,
            size: stat.size,
            source,
            type,
          };
        }
      }
    }
  } catch (e) {
    // Directory might not exist yet
  }

  return entries;
}

function buildIndex(): IndexData {
  const index: IndexData = {
    generated_at: new Date().toISOString(),
    total_wordlists: 0,
    stages: {},
  };

  const stages = ['recon', 'exploit', 'fuzzing', 'post'];

  for (const stage of stages) {
    const stagePath = join(WORDLISTS_DIR, stage);
    const entries = walkDir(stagePath, stage);

    if (Object.keys(entries).length > 0) {
      index.stages[stage] = entries;
      index.total_wordlists += Object.keys(entries).length;
    }
  }

  return index;
}

function main() {
  console.log('Building wordlist index...');

  const index = buildIndex();

  writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2));

  console.log(`Indexed ${index.total_wordlists} wordlists`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main();
