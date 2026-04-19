Now I have the full picture. Let me plan this properly.

---

## MVP Foundation Plan

The most important decision you'll make is **what you build first**. Get the foundation wrong and every agent you add creates technical debt. Get it right and each new agent is 20 lines of logic on top of solid infrastructure.

The foundation has four layers. You build them in order. Agents come last.

---

## Layer 0 — Project Structure

```
solaris/
├── src/
│   ├── core/
│   │   ├── types.ts              # Every shared type — single source of truth
│   │   ├── graph.ts              # Turso graph client (nodes, edges, traverse)
│   │   ├── event-bus.ts          # SQLite event bus (emit, consume, recover)
│   │   ├── agent-runtime.ts      # Base class every agent extends
│   │   └── llm-router.ts         # Multi-provider routing + fallback
│   ├── db/
│   │   ├── schema.sql            # All table definitions + indexes
│   │   └── migrate.ts            # Run migrations on startup
│   ├── mcp/
│   │   ├── server.ts             # Hono entry point
│   │   ├── middleware/
│   │   │   └── role-guard.ts     # AGENT_ROLE enforcement
│   │   └── tools/
│   │       ├── index.ts          # Tool registry
│   │       ├── http.ts           # http_request, http_request_raw, http_fuzz
│   │       ├── graph.ts          # graph_add_node, graph_traverse, etc.
│   │       ├── event.ts          # event_emit, event_consume
│   │       ├── browser.ts        # Puppeteer tools (Phase 3)
│   │       └── state.ts          # state_get_token, state_mark_completed
│   ├── agents/
│   │   ├── commander.ts
│   │   ├── verifier.ts
│   │   ├── alpha-recon.ts
│   │   ├── mission-planner.ts
│   │   ├── gamma.ts
│   │   ├── critic.ts
│   │   ├── osint.ts              # Phase 2
│   │   ├── chain-planner.ts      # Phase 2
│   │   ├── mcp-agent.ts          # Phase 3
│   │   ├── post-exploit.ts       # Phase 3
│   │   └── report-agent.ts       # Phase 2
│   └── config/
│       ├── target.ts             # TargetConfig loader + validator
│       └── providers.ts          # LLM provider configs
├── ecosystem.config.cjs          # PM2 process definitions
├── bunfig.toml
└── package.json
```

---

## Layer 1 — Database Schema (build this first, everything reads/writes it)

```sql
-- db/schema.sql

-- All graph nodes — every entity in the swarm
CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL,
  section     TEXT    NOT NULL,   -- "recon", "gamma", "bridge", "intel", "lessons"
  data        TEXT    NOT NULL,   -- JSON blob
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_type    ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_section ON nodes(section);
CREATE INDEX IF NOT EXISTS idx_nodes_type_section ON nodes(type, section);

-- Typed relationships between nodes
CREATE TABLE IF NOT EXISTS edges (
  id          TEXT    PRIMARY KEY,
  from_id     TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_id       TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  data        TEXT,              -- JSON, optional metadata
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);

-- Append-only event bus
CREATE TABLE IF NOT EXISTS events (
  id          TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL,
  payload     TEXT    NOT NULL,  -- JSON
  emitted_by  TEXT    NOT NULL,
  consumed    INTEGER DEFAULT 0, -- 0 = pending, 1 = consumed (INTEGER for SQLite bool)
  consumed_by TEXT,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);
-- This index is hit on every poll — must be fast
CREATE INDEX IF NOT EXISTS idx_events_poll ON events(type, consumed, created_at);

-- Agent heartbeat + state registry
CREATE TABLE IF NOT EXISTS agent_states (
  agent_id       TEXT    PRIMARY KEY,
  role           TEXT    NOT NULL,
  state          TEXT    NOT NULL,  -- DORMANT|STANDBY|ACTIVE|COOLDOWN|ERROR
  last_heartbeat INTEGER NOT NULL,
  current_event  TEXT               -- event ID currently being processed
);

-- Staging queue for Commander overflow (Section 2 capacity management)
CREATE TABLE IF NOT EXISTS staging (
  id          TEXT    PRIMARY KEY,
  event_id    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Active engagement target config
CREATE TABLE IF NOT EXISTS target_config (
  id         TEXT PRIMARY KEY DEFAULT 'current',
  data       TEXT NOT NULL,         -- JSON TargetConfig
  created_at INTEGER NOT NULL
);
```

---

## Layer 2 — Core Abstractions

### `core/types.ts` — The contract everything else implements

This is the most important file. Every type in the plan goes here. Discriminated unions everywhere so TypeScript catches mismatches at compile time, not runtime.

```typescript
// core/types.ts

export type AgentRole =
  | "commander" | "verifier"    | "alpha"
  | "mission-planner"           | "gamma"
  | "critic"    | "osint"       | "chain-planner"
  | "mcp-agent" | "post-exploit"| "report-agent";

export type AgentState = "DORMANT" | "STANDBY" | "ACTIVE" | "COOLDOWN" | "ERROR";

export type SwarmEventType =
  | "finding_written"    | "finding_validated"
  | "credential_found"   | "credential_promoted"
  | "mission_queued"     | "mission_verified"
  | "mission_authorized" | "exploit_completed"
  | "exploit_failed"     | "enrichment_requested"
  | "rce_confirmed"      | "swarm_complete"
  | "brief_ready"        | "specialist_spawn";

export type NodeType =
  | "target"   | "endpoint"   | "component"
  | "vulnerability"           | "user"
  | "credential"              | "mission"
  | "exploit"  | "artifact"  | "finding"
  | "chain"    | "lesson"    | "failed_mission"
  | "intel"    | "event"     | "handoff"
  | "belief"   | "specialist";

export type EdgeType =
  | "PART_OF"          | "DEPENDS_ON"    | "UNLOCKS"
  | "AUTHENTICATED_VIA"| "HAS_CREDENTIAL"| "FOUND_AT"
  | "LED_TO"           | "EXPLOITS"      | "EXTRACTED_FROM"
  | "CHAINS_INTO"      | "NEXT_IN_CHAIN" | "ENRICHES"
  | "IMPERSONATES"     | "ESCALATES_TO"  | "FAILED_WITH"
  | "RESOLVED_BY"      | "AFFECTS";

export interface SwarmEvent {
  id:         string;
  type:       SwarmEventType;
  payload:    Record<string, unknown>;
  emitted_by: AgentRole;
  created_at: number;
}

export interface GraphNode {
  id:         string;
  type:       NodeType;
  section:    string;
  data:       Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface GraphEdge {
  id:         string;
  from_id:    string;
  to_id:      string;
  type:       EdgeType;
  data?:      Record<string, unknown>;
  created_at: number;
}

export interface MissionNode extends GraphNode {
  type: "mission";
  data: {
    executor:         "gamma" | "mcp";
    exploit_type:     string;
    escalation_level: "baseline" | "aggressive" | "evasive";
    priority:         "critical" | "high" | "medium" | "low";
    target_endpoint:  string;
    context_nodes:    string[];
    credential_nodes: string[];
    chain_id?:        string;
    depends_on:       string[];
    status:           MissionStatus;
    authorized:       boolean;
    verified:         boolean;
    attempt_count:    number;
    created_by:       "mission_planner" | "chain_planner" | "post_exploit";
    skip_liveness_probe?: boolean;
    brief_node_id?:   string | null;
  };
}

export type MissionStatus =
  | "pending_verification" | "queued"
  | "active"               | "completed"
  | "failed"               | "archived";

export interface TargetConfig {
  name:         string;
  base_url:     string;
  repo_path?:   string;
  tech_stack?:  string[];
  scope:        string[];
  out_of_scope: string[];
  auth_hints?:  Record<string, string>;
  flags?: {
    adversarial_self_play?:    boolean;
    belief_state?:             boolean;
    cross_engagement_memory?:  boolean;
    semantic_novelty?:         boolean;
    causal_attribution?:       boolean;
    dynamic_specialists?:      boolean;
    context_relay?:            boolean;
  };
}
```

### `core/agent-runtime.ts` — The base every agent extends

This is the key to making the system dynamic and easy to extend. Every new agent is a subclass that implements `handleEvent`. The runtime handles everything else.

```typescript
// core/agent-runtime.ts
import type { AgentRole, AgentState, SwarmEvent, SwarmEventType } from "./types.ts";
import type { GraphDB } from "./graph.ts";
import type { EventBus } from "./event-bus.ts";
import type { LLMRouter } from "./llm-router.ts";

export interface AgentConfig {
  role:              AgentRole;
  pollInterval:      number;       // ms
  subscribedEvents:  SwarmEventType[];
  permanentStandby?: boolean;      // true for Commander, Verifier
}

export abstract class AgentRuntime {
  abstract config: AgentConfig;

  protected state: AgentState = "DORMANT";
  protected db!: GraphDB;
  protected bus!: EventBus;
  protected llm!: LLMRouter;
  protected target!: import("./types.ts").TargetConfig;

  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private pollTimer?:      ReturnType<typeof setInterval>;

  // The one method every agent must implement
  abstract handleEvent(event: SwarmEvent): Promise<void>;

  // Optional hooks — override as needed
  protected async onStart(): Promise<void> {}
  protected async onSchedule(): Promise<void> {}  // Alpha Recon overrides this
  protected scheduleInterval?: number;             // ms, undefined = no schedule

  async boot(deps: { db: GraphDB; bus: EventBus; llm: LLMRouter; target: import("./types.ts").TargetConfig }): Promise<void> {
    this.db     = deps.db;
    this.bus    = deps.bus;
    this.llm    = deps.llm;
    this.target = deps.target;

    await this.setState("STANDBY");
    await this.onStart();
    this.startHeartbeat();
    this.startPollLoop();
    if (this.scheduleInterval) this.startSchedule();

    console.log(`[${this.config.role}] booted → STANDBY`);
  }

  private startPollLoop(): void {
    this.pollTimer = setInterval(async () => {
      if (this.state === "ACTIVE") return;  // never double-activate

      const events = await this.bus.consume(
        this.config.subscribedEvents,
        this.config.role
      );

      for (const event of events) {
        await this.setState("ACTIVE");
        try {
          await this.handleEvent(event);
          await this.bus.markConsumed(event.id, this.config.role);
        } catch (err) {
          console.error(`[${this.config.role}] error on event ${event.id}:`, err);
          await this.setState("ERROR");
          await this.bus.emit("agent_error", {
            agent:    this.config.role,
            event_id: event.id,
            error:    String(err),
          }, this.config.role);
          // Reset after error — don't block the swarm
          await this.setState("STANDBY");
          return;
        }

        const more = await this.bus.hasPending(
          this.config.subscribedEvents,
          this.config.role
        );
        await this.setState(
          more ? "STANDBY" : (this.config.permanentStandby ? "STANDBY" : "DORMANT")
        );
      }
    }, this.config.pollInterval);
  }

  private startSchedule(): void {
    setInterval(() => this.onSchedule(), this.scheduleInterval!);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      await this.db.upsertAgentState({
        agent_id:       `${this.config.role}-${process.env.INSTANCE_ID ?? "1"}`,
        role:           this.config.role,
        state:          this.state,
        last_heartbeat: Date.now(),
      });
    }, 10_000); // every 10s
  }

  protected async setState(s: AgentState): Promise<void> {
    this.state = s;
    // State is reflected in heartbeat — no separate write needed
  }

  // Convenience: emit an event from this agent
  protected emit(type: SwarmEventType, payload: Record<string, unknown>): Promise<void> {
    return this.bus.emit(type, payload, this.config.role);
  }
}
```

With this base class, here's what a new agent looks like — **Critic is 40 lines of logic, zero boilerplate:**

```typescript
// agents/critic.ts
import { AgentRuntime } from "../core/agent-runtime.ts";

export class Critic extends AgentRuntime {
  config = {
    role:             "critic" as const,
    pollInterval:     1000,
    subscribedEvents: ["exploit_failed"] as const,
  };

  async handleEvent(event: SwarmEvent): Promise<void> {
    const { mission_id, response, status_code, attempt_count } = event.payload;
    
    const mission = await this.db.getNode(mission_id as string);
    const failureClass = await this.classifyFailure(response as string, status_code as number);
    
    if ((attempt_count as number) >= 3) {
      await this.db.addNode({ /* FailedMissionNode */ });
      await this.db.updateNode(mission_id as string, { status: "archived" });
      return;
    }

    // Increment attempt, queue retry
    await this.db.updateNode(mission_id as string, {
      attempt_count: (attempt_count as number) + 1,
      status: "pending_verification",
    });
    await this.emit("mission_queued", { mission_id });
  }

  private async classifyFailure(response: string, status: number): Promise<string> {
    const result = await this.llm.complete([
      { role: "user", content: `Classify this HTTP failure:\nStatus: ${status}\nResponse: ${response}\n\nReturn one of: waf_blocked|wrong_endpoint|auth_required|payload_rejected|target_patched|wrong_method|encoding_needed|session_required|unknown` }
    ], { provider: "groq" });  // cheap + fast for classification
    return result.trim();
  }
}
```

### `core/event-bus.ts` — The nervous system

```typescript
// core/event-bus.ts
import { createClient } from "@libsql/client";
import { randomUUID } from "crypto";
import type { SwarmEvent, SwarmEventType, AgentRole } from "./types.ts";

export class EventBus {
  constructor(private db: ReturnType<typeof createClient>) {}

  async emit(
    type: SwarmEventType | string,
    payload: Record<string, unknown>,
    emitted_by: AgentRole | string
  ): Promise<string> {
    const id = randomUUID();
    await this.db.execute({
      sql: `INSERT INTO events (id, type, payload, emitted_by, consumed, created_at)
            VALUES (?, ?, ?, ?, 0, ?)`,
      args: [id, type, JSON.stringify(payload), emitted_by, Date.now()],
    });
    return id;
  }

  async consume(types: readonly SwarmEventType[], role: AgentRole): Promise<SwarmEvent[]> {
    // Claim events atomically — prevents double-consumption by parallel Gamma instances
    const placeholders = types.map(() => "?").join(",");
    const result = await this.db.execute({
      sql: `SELECT id, type, payload, emitted_by, created_at FROM events
            WHERE type IN (${placeholders}) AND consumed = 0
            ORDER BY created_at ASC LIMIT 20`,
      args: [...types],
    });

    return result.rows.map((r) => ({
      id:         r[0] as string,
      type:       r[1] as SwarmEventType,
      payload:    JSON.parse(r[2] as string),
      emitted_by: r[3] as AgentRole,
      created_at: r[4] as number,
    }));
  }

  async markConsumed(eventId: string, by: AgentRole): Promise<boolean> {
    const result = await this.db.execute({
      sql: `UPDATE events SET consumed = 1, consumed_by = ?, consumed_at = ?
            WHERE id = ? AND consumed = 0`,
      args: [by, Date.now(), eventId],
    });
    return result.rowsAffected === 1;  // false = another agent consumed first (race)
  }

  async hasPending(types: readonly SwarmEventType[], role: AgentRole): Promise<boolean> {
    const placeholders = types.map(() => "?").join(",");
    const result = await this.db.execute({
      sql: `SELECT 1 FROM events WHERE type IN (${placeholders}) AND consumed = 0 LIMIT 1`,
      args: [...types],
    });
    return result.rows.length > 0;
  }

  // Called by heartbeat monitor every 30s — recovers orphaned events
  async recoverOrphaned(staleThresholdMs = 600_000): Promise<void> {
    await this.db.execute({
      sql: `UPDATE events SET consumed = 0, consumed_by = NULL, consumed_at = NULL
            WHERE consumed = 0 AND created_at < ?`,
      args: [Date.now() - staleThresholdMs],
    });
  }
}
```

### `core/llm-router.ts` — Multi-provider with typed provider selection

```typescript
// core/llm-router.ts

type Provider = "groq" | "cerebras" | "gemini" | "nemotron" | "anthropic";

interface CompletionOptions {
  provider?:    Provider;
  maxTokens?:   number;
  temperature?: number;
  system?:      string;
}

interface Message { role: "user" | "assistant" | "system"; content: string; }

export class LLMRouter {
  private rateState: Map<Provider, { requests: number; resetAt: number }> = new Map();

  async complete(messages: Message[], options: CompletionOptions = {}): Promise<string> {
    const provider = options.provider ?? this.selectProvider();
    
    try {
      return await this.callProvider(provider, messages, options);
    } catch (err: any) {
      if (err?.status === 429) {
        this.markRateLimited(provider);
        const fallback = this.selectProvider(provider);  // exclude current
        console.warn(`[LLMRouter] ${provider} rate limited → falling back to ${fallback}`);
        return this.callProvider(fallback, messages, options);
      }
      throw err;
    }
  }

  private selectProvider(exclude?: Provider): Provider {
    // Simple priority: groq → cerebras → gemini → nemotron → anthropic
    const order: Provider[] = ["groq", "cerebras", "gemini", "nemotron", "anthropic"];
    return order.find(p => p !== exclude && !this.isRateLimited(p)) ?? "anthropic";
  }

  private async callProvider(provider: Provider, messages: Message[], options: CompletionOptions): Promise<string> {
    switch (provider) {
      case "groq":      return this.groq(messages, options);
      case "cerebras":  return this.cerebras(messages, options);
      case "gemini":    return this.gemini(messages, options);
      case "nemotron":  return this.nemotron(messages, options);
      case "anthropic": return this.anthropic(messages, options);
    }
  }

  // Each provider method makes a raw fetch — no SDK dependencies
  private async groq(messages: Message[], options: CompletionOptions): Promise<string> {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model:       "llama-3.3-70b-versatile",
        messages:    options.system ? [{ role: "system", content: options.system }, ...messages] : messages,
        max_tokens:  options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.3,
      }),
    });
    const data = await res.json() as any;
    return data.choices[0].message.content;
  }
  // ... cerebras, gemini, nemotron, anthropic similarly
}
```

### `core/graph.ts` — Graph operations on Turso

The key decision here: store node `data` as a JSON blob rather than flattened columns. This means you never need a migration to add a field to a node type — just update the TypeScript types. The tradeoff is you can't SQL-filter on `data` fields without `json_extract`, which is fine for the query patterns in the plan.

```typescript
// core/graph.ts
import { createClient } from "@libsql/client";
import { randomUUID } from "crypto";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "./types.ts";

export class GraphDB {
  constructor(private db: ReturnType<typeof createClient>) {}

  async addNode(node: Omit<GraphNode, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<GraphNode> {
    const full: GraphNode = {
      id:         node.id ?? randomUUID(),
      type:       node.type,
      section:    node.section,
      data:       node.data,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    await this.db.execute({
      sql: `INSERT INTO nodes (id, type, section, data, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      args: [full.id, full.type, full.section, JSON.stringify(full.data), full.created_at, full.updated_at],
    });
    return full;
  }

  async updateNode(id: string, patch: Record<string, unknown>): Promise<void> {
    const node = await this.getNode(id);
    const updated = { ...node.data, ...patch };
    await this.db.execute({
      sql: `UPDATE nodes SET data = ?, updated_at = ? WHERE id = ?`,
      args: [JSON.stringify(updated), Date.now(), id],
    });
  }

  async getNode(id: string): Promise<GraphNode> {
    const result = await this.db.execute({ sql: `SELECT * FROM nodes WHERE id = ?`, args: [id] });
    if (!result.rows[0]) throw new Error(`Node not found: ${id}`);
    return this.rowToNode(result.rows[0]);
  }

  async query(filter: { type?: NodeType; section?: string; status?: string }): Promise<GraphNode[]> {
    let sql = `SELECT * FROM nodes WHERE 1=1`;
    const args: unknown[] = [];
    if (filter.type)    { sql += ` AND type = ?`;    args.push(filter.type); }
    if (filter.section) { sql += ` AND section = ?`; args.push(filter.section); }
    if (filter.status)  { sql += ` AND json_extract(data, '$.status') = ?`; args.push(filter.status); }
    const result = await this.db.execute({ sql, args });
    return result.rows.map(this.rowToNode);
  }

  async addEdge(edge: Omit<GraphEdge, "id" | "created_at">): Promise<GraphEdge> {
    const full: GraphEdge = { ...edge, id: randomUUID(), created_at: Date.now() };
    await this.db.execute({
      sql: `INSERT INTO edges (id, from_id, to_id, type, data, created_at) VALUES (?,?,?,?,?,?)`,
      args: [full.id, full.from_id, full.to_id, full.type, JSON.stringify(full.data ?? {}), full.created_at],
    });
    return full;
  }

  // BFS traversal — returns nodes reachable from nodeId within depth hops
  async traverse(nodeId: string, depth = 2): Promise<GraphNode[]> {
    const visited = new Set<string>([nodeId]);
    const queue = [nodeId];
    const result: GraphNode[] = [];

    for (let d = 0; d < depth; d++) {
      const batch = [...queue];
      queue.length = 0;
      for (const id of batch) {
        const edges = await this.db.execute({
          sql: `SELECT to_id FROM edges WHERE from_id = ? UNION SELECT from_id FROM edges WHERE to_id = ?`,
          args: [id, id],
        });
        for (const row of edges.rows) {
          const nid = row[0] as string;
          if (!visited.has(nid)) {
            visited.add(nid);
            queue.push(nid);
            result.push(await this.getNode(nid));
          }
        }
      }
    }
    return result;
  }

  // 2-hop neighborhood as a readable string for LLM context
  async contextFor(nodeId: string): Promise<string> {
    const nodes = await this.traverse(nodeId, 2);
    return nodes.map(n => `[${n.type}:${n.id}] ${JSON.stringify(n.data)}`).join("\n");
  }

  // Get missions that are ready for an executor — used by Gamma's poll loop
  async getMissions(executor: "gamma" | "mcp"): Promise<GraphNode[]> {
    const result = await this.db.execute({
      sql: `SELECT * FROM nodes
            WHERE type = 'mission'
            AND json_extract(data, '$.executor') = ?
            AND json_extract(data, '$.status') = 'queued'
            AND json_extract(data, '$.authorized') = true
            AND json_extract(data, '$.verified') = true
            ORDER BY CASE json_extract(data, '$.priority')
              WHEN 'critical' THEN 0
              WHEN 'high'     THEN 1
              WHEN 'medium'   THEN 2
              WHEN 'low'      THEN 3
            END ASC`,
      args: [executor],
    });
    return result.rows.map(this.rowToNode);
  }

  // Atomic mission claim — first writer wins
  async claimMission(missionId: string, claimedBy: string): Promise<boolean> {
    const result = await this.db.execute({
      sql: `UPDATE nodes SET data = json_patch(data, '{"status":"active","claimed_by":"${claimedBy}"}'), updated_at = ?
            WHERE id = ? AND json_extract(data, '$.status') = 'queued'`,
      args: [Date.now(), missionId],
    });
    return result.rowsAffected === 1;
  }

  private rowToNode(row: any): GraphNode {
    return {
      id:         row[0] ?? row.id,
      type:       row[1] ?? row.type,
      section:    row[2] ?? row.section,
      data:       JSON.parse(row[3] ?? row.data),
      created_at: row[4] ?? row.created_at,
      updated_at: row[5] ?? row.updated_at,
    };
  }

  async upsertAgentState(state: { agent_id: string; role: string; state: string; last_heartbeat: number }): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO agent_states (agent_id, role, state, last_heartbeat) VALUES (?,?,?,?)
            ON CONFLICT(agent_id) DO UPDATE SET state=excluded.state, last_heartbeat=excluded.last_heartbeat`,
      args: [state.agent_id, state.role, state.state, state.last_heartbeat],
    });
  }
}
```

---

## Layer 3 — MCP Server

The Hono server is the tool gateway. Every agent calls tools through it. The role guard runs before every tool handler.

```typescript
// mcp/server.ts
import { Hono } from "hono";
import { roleGuard } from "./middleware/role-guard.ts";
import { httpTools }   from "./tools/http.ts";
import { graphTools }  from "./tools/graph.ts";
import { eventTools }  from "./tools/event.ts";

export function createMCPServer(db: GraphDB, bus: EventBus, target: TargetConfig) {
  const app = new Hono();

  // All tool routes require AGENT_ROLE header
  app.use("/tools/*", roleGuard);

  // Mount tool groups
  app.route("/tools/http",   httpTools(target));
  app.route("/tools/graph",  graphTools(db));
  app.route("/tools/events", eventTools(bus));

  // Health check for Railway
  app.get("/health", (c) => c.json({ status: "ok", ts: Date.now() }));

  return app;
}

// mcp/middleware/role-guard.ts
const ROLE_PERMISSIONS: Record<string, string[]> = {
  gamma:        ["http_request","http_request_raw","http_fuzz","graph_add_node","graph_add_edge","graph_traverse","graph_query","graph_context_for","graph_get_missions","event_emit","event_consume","state_mark_completed"],
  alpha:        ["http_request","http_fuzz","graph_add_node","graph_add_edge","graph_traverse","graph_query","event_emit","event_consume"],
  commander:    ["graph_add_node","graph_add_edge","graph_traverse","graph_query","graph_context_for","event_emit","event_consume","state_mark_completed"],
  verifier:     ["graph_query","graph_context_for","event_emit","event_consume"],
  osint:        ["extract_exif","vision_analyze","scrape_js_bundle","download_artifact","graph_add_node","graph_traverse","graph_query","event_emit","event_consume"],
  // ...
};

export const roleGuard = async (c: any, next: any) => {
  const role = c.req.header("AGENT_ROLE");
  const tool = c.req.path.split("/tools/")[1]?.split("/")[1];
  if (!role || !tool) return c.json({ error: "Missing role or tool" }, 400);
  if (!ROLE_PERMISSIONS[role]?.includes(tool)) {
    return c.json({ error: `Tool '${tool}' not available for role '${role}'` }, 403);
  }
  c.set("agentRole", role);
  await next();
};
```

---

## Layer 4 — MVP Agent Build Order

Now you have the foundation. Agents are built in this exact order — each one proves the previous layer works before adding the next.

```
Phase 0 — Foundation (no agents yet)
  ✓ schema.sql + migrate.ts
  ✓ core/types.ts
  ✓ core/graph.ts
  ✓ core/event-bus.ts
  ✓ core/agent-runtime.ts
  ✓ core/llm-router.ts
  ✓ mcp/server.ts + tools (http, graph, events)
  ✓ config/target.ts
  ← Write integration tests here. Nothing runs yet but everything is testable.

Phase 1 — Prove the loop (3 agents)
  1. Alpha Recon   → scans target, writes endpoint nodes, emits finding_written
  2. Commander     → validates findings, emits finding_validated
  3. Verifier      → checks missions structurally, emits mission_verified
  ← Smoke test: point at JuiceShop, verify graph has endpoint nodes after 60s.

Phase 2 — Missions execute (2 agents)
  4. Mission Planner → consumes finding_validated, generates MissionNodes
  5. Gamma-1         → claims missions, executes HTTP exploits, emits exploit_completed/failed
  ← Smoke test: verify Gamma writes exploit nodes, findings appear in graph.

Phase 3 — Close the feedback loop (2 agents)
  6. Critic        → classifies failures, queues retries, writes LessonNodes
  7. Report Agent  → runs on swarm_complete, traverses graph, outputs markdown
  ← MVP complete. Full loop: recon → plan → execute → retry → report.

Phase 4 — Intelligence layer (3 agents)
  8. OSINT         → feed ingestion, exploit briefs
  9. Chain Planner → credential promotion → chained missions
  10. MCP Agent    → browser-driven exploits (Puppeteer)

Phase 5 — Depth (2 agents)
  11. Post-Exploit → mode 1 (RCE) + mode 2 (admin access)
  12. Specialist spawning (Gamma variant, not a new agent type)

Phase 6 — Novel features (Section 14, feature-flagged)
  13. Belief state, WAF duel, context relay, cross-engagement memory, novelty scoring
      Each is a flag in TargetConfig — off by default, testable independently.
```

---

## PM2 Ecosystem Config

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    { name: "mcp-server",      script: "bun", args: "run src/mcp/server.ts",         watch: false, env: baseEnv() },
    { name: "commander",       script: "bun", args: "run src/agents/commander.ts",    watch: false, env: agentEnv("commander") },
    { name: "verifier",        script: "bun", args: "run src/agents/verifier.ts",     watch: false, env: agentEnv("verifier") },
    // Phase 1 agents above — only these run at start
    // All others started by Commander/event loop via pm2.connect() + pm2.start()
  ],
};

function baseEnv() {
  return {
    TURSO_URL:          process.env.TURSO_URL,
    TURSO_TOKEN:        process.env.TURSO_TOKEN,
    GROQ_API_KEY:       process.env.GROQ_API_KEY,
    CEREBRAS_API_KEY:   process.env.CEREBRAS_API_KEY,
    GOOGLE_AI_KEY:      process.env.GOOGLE_AI_KEY,
    NVIDIA_API_KEY:     process.env.NVIDIA_API_KEY,
    ANTHROPIC_API_KEY:  process.env.ANTHROPIC_API_KEY,
    MCP_SERVER_URL:     "http://localhost:3001",
  };
}

function agentEnv(role: string, instance = "1") {
  return { ...baseEnv(), AGENT_ROLE: role, INSTANCE_ID: instance };
}
```

---

## Critical Design Rules to Never Break

These protect the long-term scalability of the system. Breaking any of them means expensive refactors later.

**1. Agents never talk to each other directly.** Every coordination goes through the event bus + graph. No agent imports another agent's module.

**2. Every agent is a stateless process.** An agent can be killed and restarted at any point without data loss. All state lives in Turso.

**3. The graph is the single source of truth.** If something isn't in the graph, it doesn't exist. Agents never hold state in memory across `handleEvent` calls.

**4. New agents cost ~30 lines.** If you're writing more than that of boilerplate to add an agent, the base runtime is missing something. Fix the runtime, not the agent.

**5. Feature flags at the `TargetConfig` level.** Every Section 14 feature is off by default and gated on `target.flags.*`. This lets you test the MVP loop without any novel features interfering, then turn them on one at a time.

**6. Tools are the only I/O boundary.** Agents never make HTTP calls or DB writes directly — everything goes through MCP tools. This makes it easy to add audit logging, rate limiting, or sandboxing at the tool layer without touching agent code.