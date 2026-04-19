import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type PromptId = 'orchestrator';

const PROMPTS_DIR = join(__dirname, '..', 'prompts');

export function loadPrompt(id: PromptId): string {
  const path = join(PROMPTS_DIR, `${id}.md`);
  if (!existsSync(path)) {
    console.warn(`[prompt-loader] Prompt not found: ${path}`);
    return '';
  }
  return readFileSync(path, 'utf-8');
}
