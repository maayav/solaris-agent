import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORDLISTS_DIR = join(__dirname, '..', '..', 'wordlists');
const INDEX_PATH = join(WORDLISTS_DIR, 'INDEX.json');

export interface WordlistEntry {
  path: string;
  lines: number;
  size: number;
  source: string;
  type: string;
}

export interface WordlistIndex {
  generated_at: string;
  total_wordlists: number;
  stages: Record<string, Record<string, WordlistEntry>>;
}

let cachedIndex: WordlistIndex | null = null;

export function loadWordlistIndex(): WordlistIndex {
  if (cachedIndex) return cachedIndex;

  if (!existsSync(INDEX_PATH)) {
    throw new Error(`Wordlist index not found at ${INDEX_PATH}`);
  }

  const content = readFileSync(INDEX_PATH, 'utf-8');
  cachedIndex = JSON.parse(content) as WordlistIndex;
  return cachedIndex;
}

export function findWordlist(stage: string, name: string): WordlistEntry | null {
  const index = loadWordlistIndex();
  const stageData = index.stages[stage];
  if (!stageData) return null;
  return stageData[name] || null;
}

export function getWordlistsByStage(stage: string): Record<string, WordlistEntry> {
  const index = loadWordlistIndex();
  return index.stages[stage] || {};
}

export function clearWordlistCache(): void {
  cachedIndex = null;
}

export function getWordlistPath(relativePath: string): string {
  return join(WORDLISTS_DIR, relativePath);
}
