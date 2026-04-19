import fs from 'fs';
import path from 'path';

export interface Finding {
  type: string;
  value: string;
  source: string;
  timestamp: number;
}

export interface CommandEntry {
  cmd: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  timestamp: number;
  dataFile?: string;
}

export interface SessionData {
  missionId: string;
  target: string;
  findings: Finding[];
  commands: CommandEntry[];
  secrets: { type: string; value: string }[];
  currentPlan: string[];
  completedTasks: string[];
  pendingTasks: string[];
  phase: string;
  iteration: number;
}

export class SessionStore {
  private data: SessionData;
  private basePath: string;

  constructor(basePath: string, missionId: string, target: string) {
    this.basePath = basePath;
    this.data = {
      missionId,
      target,
      findings: [],
      commands: [],
      secrets: [],
      currentPlan: [],
      completedTasks: [],
      pendingTasks: [],
      phase: 'recon',
      iteration: 0,
    };
  }

  addFinding(finding: Finding): void {
    const key = `${finding.type}:${finding.value.substring(0, 200)}`;
    const exists = this.data.findings.some(f => `${f.type}:${f.value.substring(0, 200)}` === key);
    if (!exists) {
      this.data.findings.push(finding);
    }
  }

  addCommand(cmd: string, result: { stdout: string; stderr: string; exit_code: number }, dataFile?: string): void {
    this.data.commands.push({
      cmd,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      timestamp: Date.now(),
      dataFile,
    });
  }

  addSecret(type: string, value: string): void {
    this.data.secrets.push({ type, value });
  }

  setPlan(plan: string[]): void {
    this.data.currentPlan = plan;
  }

  setPhase(phase: string): void {
    this.data.phase = phase;
  }

  setIteration(iter: number): void {
    this.data.iteration = iter;
  }

  setTasks(pending: string[], completed: string[]): void {
    this.data.pendingTasks = pending;
    this.data.completedTasks = completed;
  }

  query(type?: string, subtype?: string): string {
    const lines: string[] = [];
    lines.push(`=== SESSION QUERY ===`);
    lines.push(`Mission: ${this.data.missionId} | Target: ${this.data.target}`);
    lines.push(`Phase: ${this.data.phase} | Iteration: ${this.data.iteration}/${25}`);
    lines.push(`Commands run: ${this.data.commands.length} | Findings: ${this.data.findings.length}`);
    lines.push(``);

    if (!type || type === 'findings') {
      lines.push(`## FINDINGS (${this.data.findings.length})`);
      if (this.data.findings.length > 0) {
        const filtered = subtype
          ? this.data.findings.filter(f => f.type === subtype)
          : this.data.findings;
        for (const f of filtered.slice(-20)) {
          const preview = f.value.length > 150 ? f.value.substring(0, 150) + '...' : f.value;
          lines.push(`[${f.type}] ${preview}`);
        }
      }
      lines.push(``);
    }

    if (!type || type === 'secrets') {
      lines.push(`## SECRETS (${this.data.secrets.length})`);
      if (this.data.secrets.length > 0) {
        const filtered = subtype ? this.data.secrets.filter(s => s.type === subtype) : this.data.secrets;
        for (const s of filtered.slice(-10)) {
          const preview = s.value.length > 100 ? s.value.substring(0, 100) + '...' : s.value;
          lines.push(`[${s.type}] ${preview}`);
        }
      }
      lines.push(``);
    }

    if (!type || type === 'commands') {
      lines.push(`## RECENT COMMANDS (${this.data.commands.length} total)`);
      const recent = this.data.commands.slice(-5);
      for (const c of recent) {
        const preview = c.cmd.length > 100 ? c.cmd.substring(0, 100) + '...' : c.cmd;
        lines.push(`EXIT=${c.exit_code}: ${preview}`);
      }
      lines.push(``);
    }

    if (!type || type === 'plan') {
      lines.push(`## PLAN`);
      lines.push(`Pending (${this.data.pendingTasks.length}):`);
      for (const t of this.data.pendingTasks.slice(0, 5)) {
        lines.push(`  - ${t}`);
      }
      lines.push(`Completed (${this.data.completedTasks.length}):`);
      for (const t of this.data.completedTasks.slice(-5)) {
        lines.push(`  + ${t}`);
      }
      lines.push(``);
    }

    if (type === 'stdout' && subtype) {
      const idx = parseInt(subtype);
      if (!isNaN(idx) && idx >= 0 && idx < this.data.commands.length) {
        lines.push(`## STDOUT for command ${idx}:`);
        lines.push(this.data.commands[idx].stdout.substring(0, 3000));
      }
    }

    if (type === 'jwt') {
      const jwtSecrets = this.data.secrets.filter(s => s.type === 'jwt');
      if (jwtSecrets.length > 0) {
        lines.push(`## JWT TOKENS`);
        for (const s of jwtSecrets.slice(-3)) {
          lines.push(s.value);
        }
      }
    }

    lines.push(`==================`);
    return lines.join('\n');
  }

  getLatestJwt(): string | null {
    const jwtSecrets = this.data.secrets.filter(s => s.type === 'jwt');
    if (jwtSecrets.length > 0) {
      const latest = jwtSecrets[jwtSecrets.length - 1];
      if (latest.value.startsWith('eyJ') && latest.value.split('.').length === 3) {
        return latest.value;
      }
    }
    return null;
  }

  getQueryCommands(): string {
    return `
## Session Query Commands
To query the session store, use these commands:
  \`query()\` - Get full session summary
  \`query('findings')\` - Get all findings
  \`query('findings', 'jwt')\` - Get only JWT findings
  \`query('findings', 'credential')\` - Get only credentials
  \`query('findings', 'vulnerability')\` - Get only vulnerabilities
  \`query('secrets')\` - Get all secrets
  \`query('secrets', 'jwt')\` - Get only JWT tokens
  \`query('commands')\` - Get recent commands
  \`query('stdout', 'N')\` - Get full stdout for command index N
  \`query('jwt')\` - Get latest JWT tokens
  \`query('plan')\` - Get current plan status
  \`query('data')\` - List all stored data files

Large outputs are stored to ~/exploit-reports/<mission>/data/cmd<N>_*.txt

Example: if you need the full JWT token, use query('jwt')
Example: if you need to see what credentials were found, use query('findings', 'credential')
`;
  }
}
