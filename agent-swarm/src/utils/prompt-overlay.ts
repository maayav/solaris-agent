import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERLAYS_DIR = join(__dirname, '..', '..', 'prompt-overlays');
const GENERATED_DIR = join(__dirname, '..', '..', 'prompt-overlays-generated');

const overlayCache = new Map<string, string>();
const generatedCache = new Map<string, object>();

export interface OverlayPayload {
  category: string;
  escalation: string;
  lines: string[];
}

export interface OverlayContent {
  exploitType: string;
  context: string;
  payloads: {
    baseline: string[];
    aggressive: string[];
    evasive: string[];
  };
  bypasses: string[];
  constraints: string[];
  databaseSpecific?: Record<string, string[]>;
}

export function loadGeneratedPayload(exploitType: string): object | null {
  const normalized = exploitType.toLowerCase().replace(/\s+/g, '_');
  
  if (generatedCache.has(normalized)) {
    return generatedCache.get(normalized)!;
  }
  
  const aliases: string[] = [normalized];
  
  if (normalized === 'jwt') aliases.push('json_web_token', 'jsonwebtoken');
  if (normalized === 'sqli') aliases.push('sql_injection', 'nosql');
  if (normalized === 'ssrf') aliases.push('server_side_request_forgery');
  if (normalized === 'ssti') aliases.push('server_side_template_injection', 'template_injection');
  if (normalized === 'xxe') aliases.push('xml_external_entity');
  if (normalized === 'idor') aliases.push('insecure_direct_object_references');
  
  for (const variant of aliases) {
    const jsonPath = join(GENERATED_DIR, `${variant}.json`);
    if (existsSync(jsonPath)) {
      try {
        const content = readFileSync(jsonPath, 'utf-8');
        const parsed = JSON.parse(content);
        generatedCache.set(normalized, parsed);
        return parsed;
      } catch (e) {
        console.warn(`[prompt-overlay] Failed to parse generated overlay ${variant}:`, (e as Error).message);
      }
    }
  }
  
  return null;
}

export function listGeneratedPayloads(): string[] {
  if (!existsSync(GENERATED_DIR)) return [];
  return readdirSync(GENERATED_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

export function loadOverlay(
  exploitType: string,
  escalationLevel?: 'baseline' | 'aggressive' | 'evasive'
): string {
  const normalized = exploitType.toLowerCase().replace(/\s+/g, '_');
  const cacheKey = `${normalized}:${escalationLevel ?? 'all'}`;

  if (overlayCache.has(cacheKey)) {
    return overlayCache.get(cacheKey)!;
  }

  const nameVariants: string[] = [normalized];

  if (normalized.includes('sql') || normalized.includes('injection')) {
    nameVariants.push(
      normalized.replace(/_injection$/, 'i'),
      normalized.replace(/_injection$/, ''),
      'sqli',
      'sql_injection'
    );
  }

  if (normalized.includes('auth') && normalized.includes('bypass')) {
    nameVariants.push('auth_bypass');
  }

  if (normalized.includes('open') && normalized.includes('redirect')) {
    nameVariants.push('open_redirect');
  }

  for (const variant of nameVariants) {
    const overlayPath = join(OVERLAYS_DIR, `${variant}.md`);
    if (existsSync(overlayPath)) {
      const content = readFileSync(overlayPath, 'utf-8');
      overlayCache.set(cacheKey, content);
      return content;
    }
  }

  console.warn(`[prompt-overlay] No overlay found for exploit type: ${exploitType}`);
  return '';
}

export function parseOverlayPayloads(
  exploitType: string
): OverlayPayload[] {
  const generated = loadGeneratedPayload(exploitType);
  if (generated && (generated as any).payloads) {
    return (generated as any).payloads as OverlayPayload[];
  }
  
  const content = loadOverlay(exploitType);
  if (!content) return [];

  const payloads: OverlayPayload[] = [];
  const lines = content.split('\n');
  let currentCategory = '';
  let currentEscalation: string = 'baseline';
  let currentLines: string[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^###\s+(.+)\s+\((Baseline|Aggressive|Evasive)\)$/);
    if (sectionMatch?.[1] && sectionMatch?.[2]) {
      if (currentLines.length > 0) {
        payloads.push({
          category: currentCategory,
          escalation: currentEscalation,
          lines: [...currentLines],
        });
      }
      currentCategory = sectionMatch[1]!;
      currentEscalation = sectionMatch[2]!.toLowerCase();
      currentLines = [];
      continue;
    }

    const codeBlockMatch = line.match(/^```$/);
    if (codeBlockMatch) {
      continue;
    }

    if (line.startsWith('```')) {
      continue;
    }

    if (line.trim() && !line.startsWith('#') && !line.startsWith('---') && !line.startsWith('##')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith("'") || trimmed.startsWith('"')) {
        currentLines.push(trimmed.replace(/^[-'"]+\s*/, ''));
      }
    }
  }

  if (currentLines.length > 0) {
    payloads.push({
      category: currentCategory,
      escalation: currentEscalation,
      lines: currentLines,
    });
  }

  return payloads;
}

export function getOverlayMetadata(
  exploitType: string
): { exploitType: string; appliesTo: string[]; loading: string } | null {
  const content = loadOverlay(exploitType);
  if (!content) return null;

  const typeMatch = content.match(/\*\*Exploit Type\*\*:\s*(.+)/);
  const appliesMatch = content.match(/\*\*Applies To\*\*:\s*(.+)/);
  const loadingMatch = content.match(/\*\*Loading\*\*:\s*(.+)/);

  return {
    exploitType: typeMatch?.[1] ?? exploitType,
    appliesTo: appliesMatch?.[1]?.split(',').map(s => s.trim()) ?? [],
    loading: loadingMatch?.[1] ?? '',
  };
}

export function listAvailableOverlays(): string[] {
  if (!existsSync(OVERLAYS_DIR)) {
    return [];
  }
  return readdirSync(OVERLAYS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

export function clearOverlayCache(): void {
  overlayCache.clear();
}

export function preloadAllOverlays(): void {
  const overlays = listAvailableOverlays();
  for (const overlay of overlays) {
    loadOverlay(overlay);
  }
}
