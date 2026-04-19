import fs from 'fs';
import path from 'path';
import type { Finding, CommandResult } from './types.js';

export class Memory {
  private outputDir: string;
  private findingsPath: string;
  private commandsPath: string;
  private planPath: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.findingsPath = path.join(outputDir, 'findings.md');
    this.commandsPath = path.join(outputDir, 'commands_run.md');
    this.planPath = path.join(outputDir, 'plan.md');

    fs.mkdirSync(outputDir, { recursive: true });
  }

  appendFinding(finding: Finding): void {
    const line = `[${new Date(finding.timestamp * 1000).toISOString()}] [${finding.type}] ${finding.value}\n`;
    fs.appendFileSync(this.findingsPath, line);
  }

  appendCommand(cmd: string, result: CommandResult): void {
    const entry = `## Command\n\`\`\`\n${cmd}\n\`\`\`\n\n## Exit Code: ${result.exit_code}\n\n## Stdout\n\`\`\`\n${result.stdout.substring(0, 5000)}\n\`\`\`\n\n## Stderr\n\`\`\`\n${result.stderr.substring(0, 2000)}\n\`\`\`\n\n---\n\n`;
    fs.appendFileSync(this.commandsPath, entry);
  }

  updatePlan(plan: string): void {
    fs.writeFileSync(this.planPath, plan);
  }

  getFindings(): Finding[] {
    if (!fs.existsSync(this.findingsPath)) return [];
    const content = fs.readFileSync(this.findingsPath, 'utf-8');
    return this.parseFindings(content);
  }

  getCommands(): string[] {
    if (!fs.existsSync(this.commandsPath)) return [];
    const content = fs.readFileSync(this.commandsPath, 'utf-8');
    const matches = content.match(/```\n(curl[^\n]+)\n```/g) || [];
    return matches.map(m => m.replace(/```\n/, '').replace(/```$/, '').trim());
  }

  getFindingsForPrompt(): string {
    if (!fs.existsSync(this.findingsPath)) return '';
    const content = fs.readFileSync(this.findingsPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean).slice(-50);
    return lines.join('\n');
  }

  getRecentCommands(count: number): { cmd: string; output: string }[] {
    if (!fs.existsSync(this.commandsPath)) return [];
    const content = fs.readFileSync(this.commandsPath, 'utf-8');
    const blocks = content.split('---\n\n').filter(Boolean).slice(-count);
    return blocks.map(block => {
      const cmdMatch = block.match(/## Command\n```\n(curl[^\n]+)\n```/);
      const outputMatch = block.match(/## Stdout\n```\n([\s\S]+?)\n```/);
      return {
        cmd: cmdMatch?.[1] || '',
        output: outputMatch?.[1]?.substring(0, 2000) || '',
      };
    }).filter(e => e.cmd);
  }

  getCommandSummary(): string {
    const commands = this.getCommands();
    if (commands.length <= 10) return commands.map(c => `- ${c}`).join('\n');
    const recent = commands.slice(-10);
    const older = commands.slice(0, -10);
    let summary = `## Last ${recent.length} Commands (verbatim)\n${recent.map(c => `- ${c}`).join('\n')}\n\n## Older Commands (${older.length} total, summarized)\n`;
    const byType = this.summarizeByType(older);
    summary += byType;
    return summary;
  }

  private summarizeByType(commands: string[]): string {
    const curlCmds = commands.filter(c => c.includes('curl'));
    const getCmds = curlCmds.filter(c => c.includes('-X GET'));
    const postCmds = curlCmds.filter(c => c.includes('-X POST'));
    return `- ${curlCmds.length} curl commands total (${getCmds.length} GET, ${postCmds.length} POST)\n`;
  }

  private parseFindings(content: string): Finding[] {
    const lines = content.split('\n').filter(Boolean);
    return lines.map(line => {
      const tsMatch = line.match(/\[([\d-]+T[\d:.]+Z)\]/);
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
