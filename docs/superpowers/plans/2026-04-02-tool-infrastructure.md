# Tool Infrastructure Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Build the complete tool execution layer — ToolRegistry + 24 thin CLI shims + role-based permission matrix.

**Architecture:** LLM-driven thin shims. Gamma generates the exact CLI command string. Each tool shim receives structured args → builds command string → execTool runs it → returns ExecResult with stdout/stderr. The LLM parses raw output. No structured I/O, no wrapper logic.

**Tech Stack:** Bun runtime, Bun.spawn for CLI execution, Bun.sqlite (already), Zod for validation.

---

## Key Design Decision: Thin CLI Shims Only

```
Gamma LLM output:  nmap -sV -p 1-1000 10.0.0.1
                         ↓
Tool shim receives: { target: "10.0.0.1", ports: "1-1000", flags: "-sV" }
                         ↓
shim builds: ["nmap", "-sV", "-p", "1-1000", "10.0.0.1"]
                         ↓
execTool() runs: spawn({ cmd: ["nmap", ...] })
                         ↓
Returns: { exit_code, stdout, stderr, command, timed_out, success }
                         ↓
Gamma LLM parses stdout → next action
```

**The shim is NOT a wrapper.** It does NOT call nmap's API or build complex structured objects. It just converts `{target, ports}` → `"nmap -sV -p 1-1000 10.0.0.1"` and executes.

---

## File Map

```
agent-swarm/src/
├── core/
│   ├── tools/
│   │   ├── types.ts              # ToolArgs, ExecResult, ToolCategory, AgentRole
│   │   ├── exec-tool.ts          # Thin Bun.spawn wrapper
│   │   ├── registry.ts           # ToolRegistry with role-based permissions
│   │   └── index.ts             # Re-export
│   └── tool-registry.ts          # Re-export from core/tools/registry
└── agents/
    └── base-agent.ts              # Modify: add tool registry + executeTool()
```

---

## Task 1: Core Types

**Files:**
- Create: `agent-swarm/src/core/tools/types.ts`

- [ ] **Step 1: Create types**

```typescript
// agent-swarm/src/core/tools/types.ts

export interface ToolArgs {
  // Universal
  target?: string;
  url?: string;
  timeout?: number;
  
  // HTTP
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  data?: string;
  body?: string;
  
  // Scanning
  ports?: string;
  rate?: number;
  flags?: string;
  threads?: number;
  wordlist?: string;
  extensions?: string;
  filters?: string;
  
  // Credentials
  user?: string;
  pass?: string;
  service?: string;
  hash_file?: string;
  
  // Exploit
  level?: number;
  risk?: number;
  payload?: string;
  
  // Output
  output?: string;
  
  // Misc
  query?: string;
  [key: string]: unknown;
}

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  command: string;
  timed_out: boolean;
  success: boolean;
  duration_ms: number;
}

export type ToolCategory = 'recon' | 'exploit' | 'privesc' | 'enum' | 'utility';

export type AgentRole = 
  | 'alpha' | 'gamma' | 'mcp' | 'osint' 
  | 'post_exploit' | 'verifier' | 'commander';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  allowedRoles: AgentRole[];
  aliases?: string[];
  buildCommand(args: ToolArgs): string | null;  // Returns null if required args missing
  validateArgs?: (args: ToolArgs) => { valid: boolean; error?: string };
}
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/core/tools/types.ts
git commit -m "feat(core): add tool types - ToolArgs, ExecResult, ToolDefinition interfaces"
```

---

## Task 2: execTool (Bun.spawn thin wrapper)

**Files:**
- Create: `agent-swarm/src/core/tools/exec-tool.ts`

- [ ] **Step 1: Create execTool**

```typescript
// agent-swarm/src/core/tools/exec-tool.ts
import { spawn } from 'bun';
import type { ExecResult } from './types.js';

export interface ExecToolOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // ms, default 30000
}

export async function execTool(
  command: string,
  options: ExecToolOptions = {}
): Promise<ExecResult> {
  const timeout = options.timeout ?? 30000;
  const start = Date.now();
  
  // Parse command string into [cmd, ...args]
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  
  let timedOut = false;
  let proc: import('bun').ChildProcess | null = null;
  
  const timeoutId = setTimeout(() => {
    timedOut = true;
    if (proc) {
      proc.kill();
    }
  }, timeout);
  
  try {
    proc = spawn({
      cmd: [cmd, ...args],
      cwd: options.cwd,
      env: options.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    
    const exitCode = await proc.exit;
    
    return {
      exit_code: exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      command,
      timed_out: timedOut,
      success: exitCode === 0 && !timedOut,
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      exit_code: 1,
      stdout: '',
      stderr: String(error),
      command,
      timed_out: timedOut,
      success: false,
      duration_ms: Date.now() - start,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/core/tools/exec-tool.ts
git commit -m "feat(core): add execTool - thin Bun.spawn wrapper for CLI execution"
```

---

## Task 3: ToolRegistry

**Files:**
- Create: `agent-swarm/src/core/tools/registry.ts`

- [ ] **Step 1: Create ToolRegistry**

```typescript
// agent-swarm/src/core/tools/registry.ts
import type { ToolDefinition, ToolArgs, ExecResult, AgentRole } from './types.js';
import { execTool } from './exec-tool.js';
import { getConfig } from '../../config/index.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.registerAllTools();
    this.initialized = true;
  }

  private registerAllTools(): void {
    // Network Recon
    this.registerTool({ name: 'nmap', ... });
    this.registerTool({ name: 'masscan', ... });
    this.registerTool({ name: 'netcat', ... });
    this.registerTool({ name: 'rustscan', ... });
    
    // Web Discovery
    this.registerTool({ name: 'gobuster', ... });
    this.registerTool({ name: 'ffuf', ... });
    this.registerTool({ name: 'nikto', ... });
    this.registerTool({ name: 'nuclei', ... });
    this.registerTool({ name: 'dirsearch', ... });
    this.registerTool({ name: 'whatweb', ... });
    
    // HTTP/Exploit
    this.registerTool({ name: 'curl', ... });
    this.registerTool({ name: 'wget', ... });
    this.registerTool({ name: 'sqlmap', ... });
    
    // Credential Attacks
    this.registerTool({ name: 'john', ... });
    this.registerTool({ name: 'hashcat', ... });
    this.registerTool({ name: 'hydra', ... });
    
    // Frameworks
    this.registerTool({ name: 'searchsploit', ... });
    this.registerTool({ name: 'msfconsole', ... });
    
    // Post-Exploitation
    this.registerTool({ name: 'linpeas', ... });
    this.registerTool({ name: 'winpeas', ... });
    this.registerTool({ name: 'enum4linux', ... });
    this.registerTool({ name: 'smbclient', ... });
    this.registerTool({ name: 'ldapsearch', ... });
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
    return Array.from(this.tools.values()).filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
  }

  listToolsForRole(role: AgentRole): ToolDefinition[] {
    return this.listTools().filter(t => t.allowedRoles.includes(role));
  }

  async execute(name: string, args: ToolArgs): Promise<ExecResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return execTool(name); // Try running it directly anyway
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

    const config = getConfig();
    return execTool(command, { timeout: args.timeout ?? config.TOOL_TIMEOUT_MS ?? 30000 });
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
      .map(t => `  ${t.name}: ${t.description} (category: ${t.category})`)
      .join('\n');
  }
}

export const toolRegistry = new ToolRegistry();
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/core/tools/registry.ts
git commit -m "feat(core): create ToolRegistry with thin CLI shims and role-based permissions"
```

---

## Task 4: 24 Thin CLI Shims (batch)

**Files:**
- Create: `agent-swarm/src/core/tools/shims/nmap.ts`
- Create: `agent-swarm/src/core/tools/shims/masscan.ts`
- Create: `agent-swarm/src/core/tools/shims/netcat.ts`
- Create: `agent-swarm/src/core/tools/shims/rustscan.ts`
- Create: `agent-swarm/src/core/tools/shims/gobuster.ts`
- Create: `agent-swarm/src/core/tools/shims/ffuf.ts`
- Create: `agent-swarm/src/core/tools/shims/nikto.ts`
- Create: `agent-swarm/src/core/tools/shims/nuclei.ts`
- Create: `agent-swarm/src/core/tools/shims/dirsearch.ts`
- Create: `agent-swarm/src/core/tools/shims/whatweb.ts`
- Create: `agent-swarm/src/core/tools/shims/curl.ts`
- Create: `agent-swarm/src/core/tools/shims/wget.ts`
- Create: `agent-swarm/src/core/tools/shims/sqlmap.ts`
- Create: `agent-swarm/src/core/tools/shims/john.ts`
- Create: `agent-swarm/src/core/tools/shims/hashcat.ts`
- Create: `agent-swarm/src/core/tools/shims/hydra.ts`
- Create: `agent-swarm/src/core/tools/shims/searchsploit.ts`
- Create: `agent-swarm/src/core/tools/shims/msfconsole.ts`
- Create: `agent-swarm/src/core/tools/shims/linpeas.ts`
- Create: `agent-swarm/src/core/tools/shims/winpeas.ts`
- Create: `agent-swarm/src/core/tools/shims/enum4linux.ts`
- Create: `agent-swarm/src/core/tools/shims/smbclient.ts`
- Create: `agent-swarm/src/core/tools/shims/ldapsearch.ts`
- Create: `agent-swarm/src/core/tools/shims/index.ts`

**Shim pattern (every tool follows this exact template):**

```typescript
// agent-swarm/src/core/tools/shims/nmap.ts
import type { ToolDefinition, ToolArgs } from '../types.js';

export function buildNmap(args: ToolArgs): string | null {
  const target = args.target || args.url;
  if (!target) return null;
  
  const parts = ['nmap'];
  
  if (args.flags) parts.push(args.flags);
  if (args.ports) parts.push('-p', args.ports);
  
  parts.push(target);
  
  return parts.join(' ');
}

export const nmapTool: ToolDefinition = {
  name: 'nmap',
  description: 'Port and service scanning - detects open ports and service versions',
  category: 'recon',
  allowedRoles: ['alpha', 'gamma'],
  aliases: [],
  buildCommand: buildNmap,
  validateArgs: (args) => {
    if (!args.target && !args.url) return { valid: false, error: 'target or url required' };
    return { valid: true };
  },
};
```

**All 24 shims follow this same pattern — buildCommand() converts args to CLI string, nothing else.**

Key argument mappings (the only logic in each shim):

| Tool | Args used |
|------|-----------|
| `nmap` | `target`, `ports`, `flags` |
| `masscan` | `target`, `ports`, `rate` |
| `netcat` | `target`, `port`, `flags` |
| `rustscan` | `target`, `ports`, `flags` |
| `gobuster` | `url`, `wordlist`, `flags`, `threads` |
| `ffuf` | `url`, `wordlist`, `threads`, `filters`, `flags` |
| `nikto` | `url`, `flags` |
| `nuclei` | `target`, `templates`, `severity` |
| `dirsearch` | `url`, `extensions`, `wordlist`, `threads` |
| `whatweb` | `url`, `flags` |
| `curl` | `url`, `method`, `headers`, `data`, `timeout` |
| `wget` | `url`, `output` |
| `sqlmap` | `url`, `data`, `level`, `risk`, `flags` |
| `john` | `hash_file`, `wordlist`, `flags` |
| `hashcat` | `hash_file`, `mode`, `wordlist`, `flags` |
| `hydra` | `target`, `service`, `user`, `pass`, `wordlist` |
| `searchsploit` | `query` |
| `msfconsole` | `target`, `module`, `command` |
| `linpeas` | `target`, `flags` |
| `winpeas` | `target`, `flags` |
| `enum4linux` | `target`, `flags` |
| `smbclient` | `target`, `share`, `user`, `pass` |
| `ldapsearch` | `server`, `base`, `dn`, `password`, `flags` |

**Commit in batches of 6:**

```bash
git add agent-swarm/src/core/tools/shims/
git commit -m "feat(tools): add thin CLI shims - batch 1 (nmap, masscan, netcat, rustscan, gobuster, ffuf)"
```

---

## Task 5: Integrate into BaseAgent

**Files:**
- Modify: `agent-swarm/src/agents/base-agent.ts`
- Create: `agent-swarm/src/core/tools/index.ts`

- [ ] **Step 1: Add tool registry + executeTool to BaseAgent**

```typescript
// In base-agent.ts:
import { toolRegistry } from '../core/tools/registry.js';
import type { ToolArgs, ExecResult } from '../core/tools/types.js';

export abstract class BaseAgent {
  // ... existing fields ...
  
  protected async executeTool(
    toolName: string,
    args: ToolArgs
  ): Promise<ExecResult> {
    return toolRegistry.executeForRole(
      this.agentType as AgentRole,
      toolName,
      args
    );
  }
}
```

- [ ] **Step 2: Create tools index**

```typescript
// agent-swarm/src/core/tools/index.ts
export * from './types.js';
export * from './exec-tool.js';
export * from './registry.js';
```

- [ ] **Step 3: Commit**

```bash
git add agent-swarm/src/agents/base-agent.ts agent-swarm/src/core/tools/index.ts
git commit -m "feat(agents): integrate thin-tool registry into BaseAgent"
```
