const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const Colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

export interface ParsedOutput {
  reasoning: string;
  command: string;
  plan?: string;
  findings?: Finding[];
  summary?: string;
}

export interface Finding {
  type: string;
  value: string;
  source?: string;
}

export function parseCommandOutput(raw: string): { reasoning: string; command: string } {
  let reasoning = '';
  let command = '';

  const rMatch = raw.match(/<r>([\s\S]*?)<\/r>/);
  if (rMatch) reasoning = rMatch[1].trim();

  const cMatch = raw.match(/<c>([\s\S]*?)<\/c>/);
  if (cMatch) command = cMatch[1].trim();

  return { reasoning, command };
}

export function parsePlanOutput(raw: string): string | null {
  const phaseMatches = [...raw.matchAll(/<phase>[\s\S]*?<\/phase>/g)];
  if (phaseMatches.length === 0) return null;

  let output = `\n${BOLD}${Colors.cyan}━━━ EXTRACTED PLAN ━━━${RESET}\n\n`;

  for (const phaseBlock of phaseMatches) {
    const block = phaseBlock[0];
    const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    const tasks = [...block.matchAll(/<task>([\s\S]*?)<\/task>/g)].map(m => m[1].trim());

    if (nameMatch) {
      output += `${BOLD}${Colors.green}[${nameMatch[1]}]${RESET}`;
      if (descMatch) output += ` ${DIM}${descMatch[1]}${RESET}`;
      output += '\n';
    }

    for (const task of tasks.slice(0, 5)) {
      output += `  ${Colors.gray}→${RESET} ${task}\n`;
    }
    if (tasks.length > 5) {
      output += `  ${Colors.gray}... and ${tasks.length - 5} more tasks${RESET}\n`;
    }
    output += '\n';
  }

  return output;
}

export function parseFindings(raw: string): Finding[] {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.findings || [];
    }
  } catch { }
  return [];
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return '';

  let output = `\n${BOLD}${Colors.yellow}━━━ FINDINGS ━━━${RESET}\n`;

  for (const f of findings) {
    const typeColor = getTypeColor(f.type);
    const value = f.value.length > 80 ? f.value.substring(0, 80) + '...' : f.value;
    output += `  ${typeColor}[${f.type}]${RESET} ${value}\n`;
  }

  return output;
}

function getTypeColor(type: string): string {
  switch (type.toLowerCase()) {
    case 'jwt': return Colors.magenta;
    case 'credential': return Colors.red;
    case 'vulnerability': return Colors.red;
    case 'endpoint': return Colors.blue;
    case 'info': return Colors.gray;
    case 'raw_output': return Colors.yellow;
    default: return Colors.white;
  }
}

export function formatSummary(summary: string): string {
  return `${Colors.green}✓${RESET} ${summary}`;
}

export function formatGE(tag: string, msg: string): string {
  return `${Colors.cyan}[${tag}]${RESET} ${msg}`;
}

export function formatCommand(cmd: string): string {
  const maxLen = 120;
  const display = cmd.length > maxLen ? cmd.substring(0, maxLen) + '...' : cmd;
  return `${Colors.blue}CMD:${RESET} ${display}`;
}

export function formatIteration(iter: number, total: number): string {
  return `${Colors.cyan}[GE] ${BOLD}Iteration ${iter}/${total}${RESET}`;
}

export function formatPhase(phase: string): string {
  return `${Colors.magenta}[${phase}]${RESET}`;
}

export function colorize(raw: string): string {
  let result = raw;

  result = result.replace(/<r>([\s\S]*?)<\/r>/g, (_, text) =>
    `${Colors.gray}💭 ${text}${RESET}`
  );

  result = result.replace(/<c>([\s\S]*?)<\/c>/g, (_, cmd) =>
    `${Colors.green}> ${cmd}${RESET}`
  );

  result = result.replace(/<phase>/g, `${Colors.cyan}<phase>${RESET}`);
  result = result.replace(/<\/phase>/g, `${Colors.cyan}</phase>${RESET}`);
  result = result.replace(/<name>/g, `${Colors.green}<name>${RESET}`);
  result = result.replace(/<\/name>/g, `${Colors.green}</name>${RESET}`);
  result = result.replace(/<task>/g, `${Colors.gray}<task>${RESET}`);
  result = result.replace(/<\/task>/g, `${Colors.gray}</task>${RESET}`);

  return result;
}

export function stripXMLTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

export function formatConsoleOutput(raw: string): string {
  if (raw.includes('<r>') || raw.includes('<c>')) {
    return colorize(raw);
  }

  if (raw.includes('"findings"') || raw.includes('"type"')) {
    const findings = parseFindings(raw);
    if (findings.length > 0) {
      return formatFindings(findings);
    }
  }

  if (raw.includes('<phase>')) {
    const plan = parsePlanOutput(raw);
    if (plan) return plan;
  }

  return raw;
}
