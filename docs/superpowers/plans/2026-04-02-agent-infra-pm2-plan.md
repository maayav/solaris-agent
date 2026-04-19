# Agent Infrastructure + PM2 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Extend BaseAgent with state machine transitions, proper lifecycle management, and PM2 ecosystem config for all 12 agents.

**Architecture:** Agents are state machines (DORMANT→STANDBY→ACTIVE→COOLDOWN→DORMANT). PM2 manages process lifecycle. EventBus drives all transitions.

**Tech Stack:** Bun runtime, PM2, State machine pattern.

---

## File Map

```
agent-swarm/src/
├── agents/
│   ├── base-agent.ts              # Modify: state machine + lifecycle
│   ├── commander.ts               # Modify: full implementation
│   ├── verifier.ts                # Modify: full implementation
│   ├── gamma.ts                  # Modify: ReAct loop + mission claiming
│   ├── alpha-recon.ts            # Modify: scheduled scanning
│   ├── osint.ts                  # Modify: feed ingestion
│   ├── mcp-agent.ts              # Modify: browser automation
│   ├── mission-planner.ts        # Modify: batch + priority
│   ├── chain-planner.ts         # Modify: credential fan-out
│   ├── critic.ts                # Modify: failure classification
│   ├── post-exploit.ts          # Modify: GTFOBins lookup
│   ├── report-agent.ts          # Modify: graph traversal report
│   ├── specialist.ts            # Modify: dynamic spawn
│   ├── index.ts                 # Modify: re-exports
│   └── subscriptions.ts         # Modify: add missing events
├── config/
│   └── index.ts                  # Modify: add PM2_* env vars
├── infra/
│   ├── ecosystem.config.js   # Create: PM2 config for all agents (CommonJS .js required)
│   └── process-manager.ts    # Create: PM2 programmatic API
```

---

## Task 1: Agent State Machine

**Files:**
- Create: `agent-swarm/src/agents/state.ts`
- Modify: `agent-swarm/src/agents/base-agent.ts`

- [ ] **Step 1: Create state types**

```typescript
// agent-swarm/src/agents/state.ts

export type AgentState = 'DORMANT' | 'STANDBY' | 'ACTIVE' | 'COOLDOWN' | 'ERROR';

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  trigger: string;
}

export const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  DORMANT: ['STANDBY'],
  STANDBY: ['ACTIVE', 'DORMANT', 'ERROR'],
  ACTIVE: ['COOLDOWN', 'ERROR'],
  COOLDOWN: ['STANDBY', 'DORMANT', 'ERROR'],
  ERROR: ['DORMANT', 'STANDBY'],
};

export function canTransition(from: AgentState, to: AgentState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export const AGENT_STATES: Record<string, AgentState> = {
  commander: 'STANDBY',    // Always warm
  verifier: 'STANDBY',      // Always warm (nano model)
  gamma: 'DORMANT',
  alpha: 'DORMANT',
  osint: 'DORMANT',
  mcp: 'DORMANT',
  mission_planner: 'DORMANT',
  chain_planner: 'DORMANT',
  critic: 'DORMANT',
  post_exploit: 'DORMANT',
  report_agent: 'DORMANT',
  specialist: 'DORMANT',
};
```

- [ ] **Step 2: Extend BaseAgent with state machine**

```typescript
// In base-agent.ts, add to class:

protected state: AgentState = 'DORMANT';
protected stateChangedAt: number = Date.now();
protected errorMessage: string | null = null;

// After pollInterval:
protected readonly COOLDOWN_MS = 2000;
protected readonly ERROR_BACKOFF_MS = 30000;

// Add methods:
protected transitionTo(newState: AgentState, reason?: string): void {
  if (!canTransition(this.state, newState)) {
    console.warn(`[${this.agentId}] Invalid transition ${this.state}→${newState} (${reason || 'no reason'})`);
    return;
  }
  const oldState = this.state;
  this.state = newState;
  this.stateChangedAt = Date.now();
  console.log(`[${this.agentId}] State: ${oldState} → ${newState}${reason ? ` (${reason})` : ''}`);
}

protected isStandby(): boolean {
  return this.state === 'STANDBY';
}

protected isActive(): boolean {
  return this.state === 'ACTIVE';
}

protected isDormant(): boolean {
  return this.state === 'DORMANT';
}

protected isError(): boolean {
  return this.state === 'ERROR';
}

// Override poll() to track state:
protected async poll(): Promise<void> {
  try {
    if (this.state === 'DORMANT' || this.state === 'ERROR') {
      return; // Skip polling in these states
    }
    
    const events = await this.eventBus.consume(
      this.agentId,
      this.getSubscriptions()
    );
    
    if (events.length > 0 && this.state === 'STANDBY') {
      this.transitionTo('ACTIVE');
    }
    
    for (const event of events) {
      try {
        await this.processEvent(event);
      } catch (error) {
        console.error(`[${this.agentId}] Error processing event ${event.id}:`, error);
        this.handleError(error);
      }
    }
    
    // After processing, check if we should cooldown
    if (this.state === 'ACTIVE' && events.length === 0) {
      this.transitionTo('COOLDOWN');
      setTimeout(() => {
        this.transitionAfterCooldown();
      }, this.COOLDOWN_MS);
    }
  } catch (error) {
    console.error(`[${this.agentId}] Poll error:`, error);
    this.handleError(error);
  }
}

private transitionAfterCooldown(): void {
  if (this.state !== 'COOLDOWN') return;
  
  // Check if there are pending events
  this.eventBus.getPendingCount(this.getSubscriptions()).then(count => {
    if (count > 0) {
      this.transitionTo('STANDBY');
    } else {
      // Check initial state for this agent type
      const initialState = AGENT_STATES[this.agentType] || 'DORMANT';
      this.transitionTo(initialState);
    }
  });
}

protected handleError(error: unknown): void {
  this.errorMessage = error instanceof Error ? error.message : String(error);
  if (this.state !== 'ERROR') {
    this.transitionTo('ERROR', this.errorMessage);
    // Schedule reset
    setTimeout(() => {
      this.transitionTo('DORMANT', 'error backoff complete');
    }, this.ERROR_BACKOFF_MS);
  }
}

// New start() logic:
async start(): Promise<void> {
  if (this.running) return;
  this.running = true;
  
  console.log(`[${this.agentId}] Starting ${this.agentType} agent...`);
  await this.graph.connect();
  
  // Initial state from config
  const initialState = AGENT_STATES[this.agentType] || 'DORMANT';
  this.transitionTo(initialState, 'initial');
  
  if (initialState !== 'DORMANT') {
    this.pollingTimer = setInterval(() => {
      this.poll().catch(console.error);
    }, this.pollInterval);
  }
  
  console.log(`[${this.agentId}] Agent started in ${initialState} state, polling every ${this.pollInterval}ms`);
}
```

- [ ] **Step 3: Commit**

```bash
git add agent-swarm/src/agents/state.ts agent-swarm/src/agents/base-agent.ts
git commit -m "feat(agents): add state machine to BaseAgent - DORMANT→STANDBY→ACTIVE→COOLDOWN→ERROR"
```

---

## Task 2: Event Subscriptions (missing validation_probe events)

**Files:**
- Modify: `agent-swarm/src/events/subscriptions.ts`

- [ ] **Step 1: Add missing subscriptions**

```typescript
export const AGENT_SUBSCRIPTIONS: Record<string, SwarmEventType[]> = {
  'commander': [
    'finding_written',           // Added
    'credential_found',
    'mission_verified',
    'exploit_completed',
    'exploit_failed',
    'swarm_complete',
    'validation_probe_complete',  // Added - MCP Agent probe result
  ],
  'verifier': [
    'mission_queued',
  ],
  'mission_planner': [
    'finding_validated',
  ],
  'gamma': [
    'mission_authorized',        // Only mission_authorized - Commander authorizes before Gamma picks up
    'brief_ready',
    'waf_duel_started',
    'handoff_requested',
  ],
  'mcp': [
    'mission_authorized',
    'validation_probe_requested', // Added - from Commander for bridge validation
  ],
  'alpha': [],                  // Scheduled only, no event subscriptions
  'osint': [
    'mission_queued',
    'enrichment_requested',
    'exploit_failed',
    'waf_duel_started',
  ],
  'chain_planner': [
    'credential_found',
    'credential_promoted',
    'exploit_completed',
  ],
  'critic': [
    'exploit_failed',
  ],
  'post_exploit': [
    'rce_confirmed',
  ],
  'report_agent': [
    'swarm_complete',
  ],
  'specialist': [
    'specialist_activated',
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/events/subscriptions.ts
git commit -m "fix(events): add missing validation_probe subscriptions per spec"
```

---

## Task 3: PM2 Ecosystem Config

**Files:**
- Create: `agent-swarm/ecosystem.config.js` (PM2 requires `.js`, not `.ts`)

- [ ] **Step 1: Create PM2 ecosystem config**

```javascript
// agent-swarm/ecosystem.config.js
// PM2 requires CommonJS .js format - do NOT use TypeScript here

const getAgentScript = (agent) => {
  return `bun run src/agents/${agent}.ts`;
};

const commonEnv = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  FALKORDB_HOST: process.env.FALKORDB_HOST || 'localhost',
  FALKORDB_PORT: process.env.FALKORDB_PORT || '6379',
  FALKORDB_USERNAME: process.env.FALKORDB_USERNAME || 'falkordb',
  FALKORDB_PASSWORD: process.env.FALKORDB_PASSWORD || '',
  SQLITE_EVENTS_PATH: process.env.SQLITE_EVENTS_PATH || './solaris-events.db',
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  OLLAMA_ENABLED: process.env.OLLAMA_ENABLED || 'true',
};

const configs = [
  // Always-on processes
  {
    name: 'commander',
    script: getAgentScript('commander'),
    env: { AGENT_ROLE: 'commander', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    instance_var: 'INSTANCE_ID',
  },
  {
    name: 'verifier',
    script: getAgentScript('verifier'),
    env: { AGENT_ROLE: 'verifier', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    instance_var: 'INSTANCE_ID',
  },
  {
    name: 'mcp-server',
    script: 'bun run src/mcp/server.ts',
    env: { AGENT_ROLE: 'mcp-server', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    instance_var: 'INSTANCE_ID',
  },
  
  // Gamma pool - starts with 1, scales to 3
  {
    name: 'gamma-1',
    script: getAgentScript('gamma'),
    env: { AGENT_ROLE: 'gamma', INSTANCE_ID: '1', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    instance_var: 'INSTANCE_ID',
  },
  
  // On-demand agents
  {
    name: 'alpha-recon',
    script: getAgentScript('alpha-recon'),
    env: { AGENT_ROLE: 'alpha', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    instance_var: 'INSTANCE_ID',
    restart_delay: 4000,
  },
  {
    name: 'osint',
    script: getAgentScript('osint'),
    env: { AGENT_ROLE: 'osint', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    instance_var: 'INSTANCE_ID',
    restart_delay: 4000,
  },
  {
    name: 'mission-planner',
    script: getAgentScript('mission-planner'),
    env: { AGENT_ROLE: 'mission_planner', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    instance_var: 'INSTANCE_ID',
    restart_delay: 4000,
  },
  {
    name: 'chain-planner',
    script: getAgentScript('chain-planner'),
    env: { AGENT_ROLE: 'chain_planner', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    instance_var: 'INSTANCE_ID',
    restart_delay: 4000,
  },
  {
    name: 'critic',
    script: getAgentScript('critic'),
    env: { AGENT_ROLE: 'critic', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    instance_var: 'INSTANCE_ID',
    restart_delay: 4000,
  },
  {
    name: 'post-exploit',
    script: getAgentScript('post-exploit'),
    env: { AGENT_ROLE: 'post_exploit', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    instance_var: 'INSTANCE_ID',
    restart_delay: 4000,
  },
  {
    name: 'report-agent',
    script: getAgentScript('report-agent'),
    env: { AGENT_ROLE: 'report_agent', ...commonEnv },
    autorestart: false,  // One-shot, no autorestart
    watch: false,
    max_memory_restart: '2G',
    instance_var: 'INSTANCE_ID',
  },
];

module.exports = configs;  // PM2 requires CommonJS
```

- [ ] **Step 2: Create PM2 process manager for gamma scaling**

```typescript
// agent-swarm/src/infra/process-manager.ts

import pm2 from 'pm2';

const GAMMA_POOL_MAX = parseInt(process.env.GAMMA_POOL_MAX || '3');

interface GammaPoolStatus {
  active: number;
  total: number;
  instances: string[];
}

class ProcessManager {
  private gammaPool: Set<string> = new Set(['gamma-1']);
  private scaling = false;
  
  async connect(): Promise<void> {
    await pm2.connect();
  }
  
  async getGammaPoolStatus(): Promise<GammaPoolStatus> {
    return {
      active: this.gammaPool.size,
      total: GAMMA_POOL_MAX,
      instances: Array.from(this.gammaPool),
    };
  }
  
  async scaleGammaIfNeeded(queuedCount: number): Promise<void> {
    if (this.scaling) return;
    
    const currentCount = this.gammaPool.size;
    
    if (queuedCount > 1 && currentCount < GAMMA_POOL_MAX) {
      this.scaling = true;
      const nextInstance = currentCount + 1;
      
      if (nextInstance <= GAMMA_POOL_MAX) {
        const instanceName = `gamma-${nextInstance}`;
        
        console.log(`[ProcessManager] Scaling gamma pool: starting ${instanceName}`);
        
        try {
          await pm2.start({
            name: instanceName,
            script: 'bun',
            args: ['run', 'src/agents/gamma.ts'],
            env: {
              AGENT_ROLE: 'gamma',
              INSTANCE_ID: String(nextInstance),
              NODE_ENV: process.env.NODE_ENV || 'development',
              FALKORDB_HOST: process.env.FALKORDB_HOST || 'localhost',
              FALKORDB_PORT: process.env.FALKORDB_PORT || '6379',
              FALKORDB_USERNAME: process.env.FALKORDB_USERNAME || 'falkordb',
              FALKORDB_PASSWORD: process.env.FALKORDB_PASSWORD || '',
              SQLITE_EVENTS_PATH: process.env.SQLITE_EVENTS_PATH || './solaris-events.db',
              OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
              OLLAMA_ENABLED: process.env.OLLAMA_ENABLED || 'true',
            },
            autorestart: true,
            max_memory_restart: '2G',
          });
          
          this.gammaPool.add(instanceName);
          console.log(`[ProcessManager] ${instanceName} started via PM2, pool size: ${this.gammaPool.size}`);
        } catch (error) {
          console.error(`[ProcessManager] Failed to start ${instanceName}: ${error}`);
        } finally {
          this.scaling = false;
        }
      }
    }
  }
  
  async scaleDownGamma(instanceName: string): Promise<void> {
    if (!this.gammaPool.has(instanceName)) return;
    if (instanceName === 'gamma-1') return; // Never scale down the base
    
    try {
      await pm2.delete(instanceName);
      this.gammaPool.delete(instanceName);
      console.log(`[ProcessManager] Scaled down ${instanceName}, pool size: ${this.gammaPool.size}`);
    } catch (error) {
      console.error(`[ProcessManager] Failed to scale down ${instanceName}: ${error}`);
    }
  }
  
  async disconnect(): Promise<void> {
    await pm2.disconnect();
  }
}

export const processManager = new ProcessManager();
```

- [ ] **Step 3: Commit**

```bash
git add agent-swarm/ecosystem.config.js agent-swarm/src/infra/process-manager.ts
git commit -m "feat(infra): add PM2 ecosystem config with gamma pool scaling"
```

---

## Task 4: Prompt Loader Utility

**Files:**
- Create: `agent-swarm/src/utils/prompt-loader.ts`

- [ ] **Step 1: Create prompt loader**

```typescript
// agent-swarm/src/utils/prompt-loader.ts
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'agent-system-prompts');

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
  
  // Extract everything after "## System Prompt" until next "##" or EOF
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
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/utils/prompt-loader.ts
git commit -m "feat(utils): add prompt-loader for system prompt extraction"
```

---

## Task 5: Config extensions

**Files:**
- Modify: `agent-swarm/src/config/index.ts`

- [ ] **Step 1: Add PM2 + pool config**

```typescript
// Add to schema:
GAMMA_POOL_MAX: z.coerce.number().default(3),
GAMMA_MEMORY_LIMIT: z.string().default('2G'),
TOOL_TIMEOUT_MS: z.coerce.number().default(30000),
SANDBOX_ENABLED: z.enum(['true', 'false']).default('false'),
OLLAMA_ENABLED: z.enum(['true', 'false']).default('true'),
```

- [ ] **Step 2: Commit**

```bash
git add agent-swarm/src/config/index.ts
git commit -m "feat(config): add PM2 pool and tool timeout config"
```
