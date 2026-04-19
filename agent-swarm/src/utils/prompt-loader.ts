import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', 'src', 'agent-system-prompts');

const promptCache = new Map<string, string>();

export type AgentPromptId =
  | 'commander' | 'gamma' | 'critic' | 'verifier'
  | 'alpha-recon' | 'osint' | 'chain-planner' | 'mission-planner'
  | 'post-exploit' | 'report-agent' | 'mcp-agent' | 'specialist';

export function loadAgentPrompt(agentId: AgentPromptId): string {
  if (promptCache.has(agentId)) {
    return promptCache.get(agentId)!;
  }

  const promptPath = join(PROMPTS_DIR, `${agentId}.md`);

  if (!existsSync(promptPath)) {
    console.warn(`[prompt-loader] Prompt not found: ${promptPath}`);
    return '';
  }

  const content = readFileSync(promptPath, 'utf-8');
  promptCache.set(agentId, content);
  return content;
}

export function loadSystemPrompt(agentId: AgentPromptId): string {
  const full = loadAgentPrompt(agentId);

  const match = full.match(/## System Prompt\s*\n([\s\S]*?)(?=^##|\n##\s|\n#\s|$)/m);

  return match?.[1]?.trim() ?? '';
}

export function preloadAllPrompts(): void {
  const promptIds: AgentPromptId[] = [
    'commander', 'gamma', 'critic', 'verifier',
    'alpha-recon', 'osint', 'chain-planner', 'mission-planner',
    'post-exploit', 'report-agent', 'mcp-agent', 'specialist',
  ];

  for (const id of promptIds) {
    loadAgentPrompt(id);
  }

  console.log(`[prompt-loader] Preloaded ${promptCache.size} prompts`);
}

export function clearPromptCache(): void {
  promptCache.clear();
}
