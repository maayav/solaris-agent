import fs from 'fs';
import type { Finding, CommandResult } from './types.js';

export class StreamingMemory {
  private outputDir: string;
  private liveLogPath: string;
  private findingsPath: string;
  private commandsPath: string;
  private planPath: string;
  private secretsPath: string;
  private seenFindings: Set<string>;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.liveLogPath = `${outputDir}/live.md`;
    this.findingsPath = `${outputDir}/findings.md`;
    this.commandsPath = `${outputDir}/commands.md`;
    this.planPath = `${outputDir}/plan.md`;
    this.secretsPath = `${outputDir}/secrets.md`;
    this.seenFindings = new Set();

    fs.mkdirSync(outputDir, { recursive: true });

    this.log('# Gamma Experimental Live Log\n');
    this.log(`Started at: ${new Date().toISOString()}\n`);
    this.log('---\n');
  }

  log(message: string): void {
    const line = `${message}`;
    fs.appendFileSync(this.liveLogPath, line);
  }

  logSection(title: string): void {
    this.log(`\n## ${title} [${new Date().toISOString()}] ##\n`);
  }

  appendFinding(finding: Finding): void {
    const key = `${finding.type}:${finding.value.substring(0, 200)}`;
    if (this.seenFindings.has(key)) {
      this.log(`DUPLICATE SKIPPED: [${finding.type}] ${finding.value.substring(0, 50)}...\n`);
      return;
    }
    this.seenFindings.add(key);

    const line = `[${new Date().toISOString()}] [${finding.type}] ${finding.value}\n`;
    fs.appendFileSync(this.findingsPath, line);

    if (finding.type === 'jwt' && finding.value.startsWith('eyJ')) {
      this.appendSecret('jwt', finding.value);
    } else if (finding.type === 'credential') {
      this.appendSecret('credential', finding.value);
    }

    this.log(`FINDING: [${finding.type}] ${finding.value.substring(0, 100)}\n`);
  }

  appendSecret(type: string, value: string): void {
    const line = `[${new Date().toISOString()}] [${type}] ${value}\n`;
    fs.appendFileSync(this.secretsPath, line);
  }

  getSecrets(type?: string): string {
    if (!fs.existsSync(this.secretsPath)) return '';
    const content = fs.readFileSync(this.secretsPath, 'utf-8');
    if (!type) return content;
    const lines = content.split('\n').filter(l => l.includes(`[${type}]`));
    return lines.join('\n');
  }

  getSecretsSummary(): { type: string; count: number; latest: string }[] {
    if (!fs.existsSync(this.secretsPath)) return [];
    const content = fs.readFileSync(this.secretsPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const types: Record<string, string[]> = {};
    for (const line of lines) {
      const match = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.+)/);
      if (match) {
        const [, foundType, , value] = match;
        if (!types[foundType]) types[foundType] = [];
        types[foundType].push(value);
      }
    }
    return Object.entries(types).map(([t, vals]) => ({
      type: t,
      count: vals.length,
      latest: vals[vals.length - 1],
    }));
  }

  appendCommand(cmd: string, result: CommandResult): void {
    const entry = `## Command\n${cmd}\n\nExit: ${result.exit_code} | Timeout: ${result.timed_out}\n\nSTDOUT:\n${result.stdout.substring(0, 3000)}\n\nSTDERR:\n${result.stderr.substring(0, 1000)}\n\n---\n\n`;
    fs.appendFileSync(this.commandsPath, entry);
    this.log(`CMD: ${cmd.substring(0, 120)}\n`);
    this.log(`EXIT: ${result.exit_code} | SIZE: ${result.stdout.length} bytes\n`);
  }

  updatePlan(plan: string): void {
    fs.writeFileSync(this.planPath, plan);
    this.log(`PLAN UPDATED\n`);
  }

  getFindings(): Finding[] {
    if (!fs.existsSync(this.findingsPath)) return [];
    const content = fs.readFileSync(this.findingsPath, 'utf-8');
    return this.parseFindings(content);
  }

  getCommandCount(): number {
    if (!fs.existsSync(this.commandsPath)) return 0;
    const content = fs.readFileSync(this.commandsPath, 'utf-8');
    return (content.match(/^## Command$/gm) || []).length;
  }

  private parseFindings(content: string): Finding[] {
    const lines = content.split('\n').filter(Boolean);
    return lines.map(line => {
      const tsMatch = line.match(/\[([\d-T:.Z]+)\]/);
      const typeMatch = line.match(/\[([^\]]+)\]/);
      const value = line.replace(/\[[^\]]+\]\s*\[[^\]]+\]\s*/, '');
      return {
        timestamp: tsMatch ? new Date(tsMatch[1]).getTime() / 1000 : 0,
        type: (typeMatch?.[1] || 'info') as Finding['type'],
        value,
        source: '',
      };
    });
  }
}
