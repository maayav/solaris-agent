import type { ToolDefinition, ToolArgs, ExecResult, AgentRole } from './types.js';
import { execTool } from './exec-tool.js';
import { nmapTool } from './shims/nmap.js';
import { masscanTool } from './shims/masscan.js';
import { netcatTool } from './shims/netcat.js';
import { rustscanTool } from './shims/rustscan.js';
import { gobusterTool } from './shims/gobuster.js';
import { ffufTool } from './shims/ffuf.js';
import { niktoTool } from './shims/nikto.js';
import { dirsearchTool } from './shims/dirsearch.js';
import { whatwebTool } from './shims/whatweb.js';
import { curlTool } from './shims/curl.js';
import { wgetTool } from './shims/wget.js';
import { sqlmapTool } from './shims/sqlmap.js';
import { johnTool } from './shims/john.js';
import { hashcatTool } from './shims/hashcat.js';
import { hydraTool } from './shims/hydra.js';
import { searchsploitTool } from './shims/searchsploit.js';
import { msfconsoleTool } from './shims/msfconsole.js';
import { linpeasTool } from './shims/linpeas.js';
import { winpeasTool } from './shims/winpeas.js';
import { enum4linuxTool } from './shims/enum4linux.js';
import { smbclientTool } from './shims/smbclient.js';
import { ldapsearchTool } from './shims/ldapsearch.js';
import { echoTool } from './shims/echo.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.registerAllTools();
    this.initialized = true;
  }

  private registerAllTools(): void {
    this.registerTool(nmapTool);
    this.registerTool(masscanTool);
    this.registerTool(netcatTool);
    this.registerTool(rustscanTool);
    this.registerTool(gobusterTool);
    this.registerTool(ffufTool);
    this.registerTool(niktoTool);
    this.registerTool(dirsearchTool);
    this.registerTool(whatwebTool);
    this.registerTool(curlTool);
    this.registerTool(wgetTool);
    this.registerTool(sqlmapTool);
    this.registerTool(johnTool);
    this.registerTool(hashcatTool);
    this.registerTool(hydraTool);
    this.registerTool(searchsploitTool);
    this.registerTool(msfconsoleTool);
    this.registerTool(linpeasTool);
    this.registerTool(winpeasTool);
    this.registerTool(enum4linuxTool);
    this.registerTool(smbclientTool);
    this.registerTool(ldapsearchTool);
    this.registerTool(echoTool);
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    for (const alias of tool.aliases ?? []) {
      this.tools.set(alias, tool);
    }
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolDefinition[] {
    const seen = new Set<string>();
    return Array.from(this.tools.values()).filter((t) => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
  }

  listToolsForRole(role: AgentRole): ToolDefinition[] {
    return this.listTools().filter((t) => t.allowedRoles.includes(role));
  }

  async execute(name: string, args: ToolArgs): Promise<ExecResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return execTool(name);
    }

    const command = tool.buildCommand(args);
    if (!command) {
      return {
        exit_code: 1,
        stdout: '',
        stderr: `Missing required args for tool '${name}'`,
        command: name,
        timed_out: false,
        success: false,
        duration_ms: 0,
      };
    }

    return execTool(command, { timeout: args.timeout ?? 30000 });
  }

  async executeForRole(role: AgentRole, name: string, args: ToolArgs): Promise<ExecResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        exit_code: 1,
        stdout: '',
        stderr: `Tool '${name}' not found`,
        command: name,
        timed_out: false,
        success: false,
        duration_ms: 0,
      };
    }
    if (!tool.allowedRoles.includes(role)) {
      return {
        exit_code: 1,
        stdout: '',
        stderr: `Tool '${name}' not available for role '${role}'`,
        command: name,
        timed_out: false,
        success: false,
        duration_ms: 0,
      };
    }
    return this.execute(name, args);
  }

  getPromptDescriptionForRole(role: AgentRole): string {
    return this.listToolsForRole(role)
      .map((t) => `  ${t.name}: ${t.description} (category: ${t.category})`)
      .join('\n');
  }
}

export const toolRegistry = new ToolRegistry();