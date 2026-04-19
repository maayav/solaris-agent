# Solaris-Agent MVP: Graph Network Infrastructure

**Version:** 1.3  
**Date:** 2026-04-01  
**Focus:** Graph network backbone implementation first  
**LLM Strategy:** Stubbed/Mocked for infrastructure testing  

---

## Executive Summary

This MVP implements the **graph network backbone** of Solaris-Agent — the critical infrastructure layer that all agents depend on. The graph is the **single source of truth** for all swarm state: mission queues, discovered endpoints, credentials, vulnerabilities, attack chains, and cross-agent communication.

**Out of Scope for MVP:**
- LLM integration (stubbed)
- Actual exploit execution
- MCP server tools
- PM2 process management
- Advanced features (Section 14a-14g)

**In Scope for MVP:**
- Complete FalkorDB schema (all node types, edge types, indexes)
- Memory sections architecture (recon/, gamma/, bridge/, intel/, lessons/, events/)
- Graph client library with type-safe operations (Zod schemas)
- SQLite event bus (append-only, agent-trigger based)
- Supabase integration for persistent storage
- Agent skeleton with mocked LLM responses
- Mission queue management in graph

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        SOLARIS AGENT                             │
│                      Graph Network MVP                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Commander  │  │  Verifier    │  │   Gamma-1    │          │
│  │   (Agent)   │  │   (Agent)    │  │   (Agent)    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                   │
│         └──────────────────┼──────────────────┘                   │
│                            │                                      │
│                   ┌────────▼────────┐                            │
│                   │   MCP Server   │                            │
│                   │  (Tool Router) │                            │
│                   └────────┬────────┘                            │
│                            │                                      │
│         ┌──────────────────┼──────────────────┐                 │
│         │                  │                  │                 │
│  ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐         │
│  │  FalkorDB   │   │   Supabase  │   │   SQLite    │         │
│  │   (Graph)   │   │ (Relational)│   │(Event Bus)  │         │
│  │  via ioredis│   │             │   │             │         │
│  └─────────────┘   └─────────────┘   └─────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Agent Action → Event Emit (SQLite) → Event Consume (polling)
                    ↓
              Graph Write (FalkorDB via Redis protocol)
                    ↓
              State Read (other agents poll graph)
                    ↓
              Supabase Sync (engagement data, lessons)
```

### FalkorDB Clarification

**FalkorDB is Redis-compatible.** It uses the Redis protocol over TCP (port 6379). There is NO separate `falkordb` npm package. Use standard Redis clients:

- **ioredis** (recommended for Node.js) - already in project
- **@upstash/redis** (HTTP-based, for edge/serverless)
- **redis** (Node.js, promise-based)

```typescript
// CORRECT - FalkorDB uses Redis protocol
import Redis from 'ioredis';
const falkordb = new Redis({ host: 'localhost', port: 6379, password: 'pass' });

// WRONG - No 'falkordb' package exists
import { FalkorDB } from 'falkordb'; // ❌ This package doesn't exist
```

---

## 2. Infrastructure Setup

### 2.1 FalkorDB (Railway) - PRIMARY

**Production:** FalkorDB hosted on Railway

1. **Create Railway Project:**
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli
   
   # Login
   railway login
   
   # Create project
   railway init --name solaris-graph
   cd solaris-graph
   ```

2. **Add FalkorDB Plugin:**
   ```bash
   railway add --plugin falkordb
   ```

3. **Get Connection Details:**
   ```bash
   railway env
   # Look for:
   # FALKORDB_HOST (e.g., ironwing.railway.app)
   # FALKORDB_PORT (default: 6379)
   # FALKORDB_PASSWORD
   # FALKORDB_USERNAME (usually "falkordb")
   ```

4. **Add to `agent-swarm/.env`:**
   ```
   FALKORDB_HOST=your-falkordb-host.railway.app
   FALKORDB_PORT=6379
   FALKORDB_USERNAME=falkordb
   FALKORDB_PASSWORD=your-password-from-railway
   ```

**Local Development (Alternative):**
```bash
# Navigate to agent-swarm directory
cd agent-swarm

# Run FalkorDB via Docker
docker-compose up -d

# Then set in .env:
# FALKORDB_HOST=localhost
# FALKORDB_PORT=6379
# FALKORDB_PASSWORD=falkordb_dev_password
```

### 2.2 Project Structure: `agent-swarm/`

All implementation code lives in `agent-swarm/`:

```
solaris-agent/
├── agent-swarm/              # ← MAIN WORKING DIRECTORY
│   ├── src/
│   │   ├── graph/           # Graph schema, queries, missions
│   │   ├── events/          # SQLite event bus
│   │   ├── agents/          # Agent implementations
│   │   ├── infra/           # FalkorDB, Supabase, SQLite clients
│   │   └── config/          # Environment config
│   ├── tests/               # Unit and integration tests
│   ├── docker-compose.yml   # Local dev infrastructure
│   ├── .env                 # Environment (gitignored)
│   └── package.json
├── docs/                     # Architecture documents
└── swarm-ts/                # Legacy codebase (reference only)
```

### 2.3 Supabase (Persistent Storage)

**Setup Instructions:**

1. **Create Supabase Project:**
   - Go to https://supabase.com
   - Create new project: `solaris-agent`
   - Save the `anon` and `service_role` keys

2. **Get Connection Details:**
   ```
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ... (for server-side only)
   ```

3. **Database Schema:**
   ```sql
   -- Run in Supabase SQL Editor
   
   -- Cross-engagement lessons (persistent across runs)
   CREATE TABLE cross_engagement_lessons (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     stack_fingerprint JSONB NOT NULL,
     engagement_id TEXT NOT NULL,
     target_class TEXT,
     exploit_type TEXT NOT NULL,
     failure_class TEXT,
     successful_payload TEXT,
     delta TEXT,
     reusable BOOLEAN DEFAULT false,
     tags TEXT[],
     created_at TIMESTAMPTZ DEFAULT now(),
     relevance_score FLOAT DEFAULT 0.5
   );
   
   -- Engagement history
   CREATE TABLE engagements (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     name TEXT NOT NULL,
     target_config JSONB NOT NULL,
     status TEXT DEFAULT 'active',
     started_at TIMESTAMPTZ DEFAULT now(),
     completed_at TIMESTAMPTZ,
     report_path TEXT
   );
   
   -- Run reports archive
   CREATE TABLE run_reports (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     engagement_id UUID REFERENCES engagements(id),
     content JSONB NOT NULL,
     created_at TIMESTAMPTZ DEFAULT now()
   );
   
   -- Target configurations for re-engagement
   CREATE TABLE target_configs (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     name TEXT NOT NULL,
     config JSONB NOT NULL,
     created_at TIMESTAMPTZ DEFAULT now(),
     updated_at TIMESTAMPTZ DEFAULT now()
   );
   
   -- Indexes
   CREATE INDEX idx_lessons_stack ON cross_engagement_lessons USING GIN (stack_fingerprint);
   CREATE INDEX idx_lessons_exploit_type ON cross_engagement_lessons(exploit_type);
   CREATE INDEX idx_engagements_status ON engagements(status);
   CREATE INDEX idx_reports_engagement ON run_reports(engagement_id);
   ```

### 2.3 SQLite (Event Bus)

**Local Setup:**
- SQLite file created automatically at `./solaris-events.db`
- Location configurable via `SQLITE_EVENTS_PATH` env var

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSON NOT NULL,
  consumed INTEGER DEFAULT 0,
  consumed_by TEXT,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_consumed ON events(consumed);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
```

### 2.4 TTL Policies for Event Bus

To prevent SQLite bloat, events are cleaned up based on TTL:

| Event Type | TTL | Reason |
|------------|-----|--------|
| `swarm_complete` | Forever | Historical record |
| `finding_validated` | 1 hour | Processed and stored in graph |
| `mission_authorized` | 1 hour | Processed and stored in graph |
| `exploit_completed` | 1 hour | Processed and stored in graph |
| `exploit_failed` | 24 hours | Critic needs to reference |
| `brief_ready` | 30 minutes | Consumed quickly |
| All others | 10 minutes | Short-lived triggers |

```typescript
// events/cleanup.ts
const EVENT_TTL: Record<SwarmEventType, number | null> = {
  swarm_complete: null,           // Keep forever
  finding_validated: 3600000,      // 1 hour
  mission_authorized: 3600000,    // 1 hour
  exploit_completed: 3600000,      // 1 hour
  exploit_failed: 86400000,        // 24 hours
  brief_ready: 1800000,          // 30 minutes
  // All others: 600000 (10 minutes default)
};

export async function cleanupOrphanedEvents(db: Database): Promise<number> {
  const cutoff = Date.now() - 600000; // 10 min default
  const result = await db.run(`
    DELETE FROM events 
    WHERE consumed = 1 
      AND consumed_at < ?
      AND type NOT IN ('swarm_complete', 'exploit_failed')
  `, [cutoff]);
  return result.changes;
}
```

---

## 3. Environment Configuration

### 3.1 Required Environment Variables

Create `.env` in `swarm-ts/` directory:

```bash
# ===========================================
# FALKORDB (Graph Memory) - via Redis protocol
# ===========================================
FALKORDB_HOST=localhost          # or your Railway FalkorDB host
FALKORDB_PORT=6379              # default: 6379
FALKORDB_USERNAME=falkordb
FALKORDB_PASSWORD=yourpassword
FALKORDB_DATABASE=0             # default: 0

# Connection pool settings (optional)
FALKORDB_MAX_CONNECTIONS=10      # Max connections in pool
FALKORDB_CONNECT_TIMEOUT=5000    # Connection timeout in ms

# ===========================================
# SUPABASE (Persistent Storage)
# ===========================================
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# ===========================================
# SQLITE (Event Bus)
# ===========================================
SQLITE_EVENTS_PATH=./solaris-events.db

# ===========================================
# OLLAMA (Local LLM - Optional for MVP)
# ===========================================
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_ENABLED=false            # Set to true when LLM integration is ready

# ===========================================
# AGENT CONFIGURATION
# ===========================================
AGENT_ROLE=commander            # Set at runtime by PM2
AGENT_INSTANCE_ID=commander-1   # Set at runtime
LOG_LEVEL=info
NODE_ENV=development
```

### 3.2 Manual Setup Checklist

- [ ] FalkorDB instance running (Railway cloud OR local Docker)
- [ ] Supabase project created and schema applied
- [ ] `swarm-ts/.env` file created with all variables
- [ ] Dependencies installed: `bun install`
- [ ] TypeScript compiles: `bun run typecheck`

---

## 4. Graph Schema (FalkorDB)

### 4.1 Node Types (Zod Schemas)

All node types use Zod schemas for runtime validation. This ensures data integrity across all agents.

```typescript
// graph/schema.ts
import { z } from 'zod';

// ===========================================
// CORE NODE SCHEMAS
// ===========================================

export const TargetNodeSchema = z.object({
  id: z.string(),
  type: z.literal('target'),
  name: z.string(),
  base_url: z.string().url(),
  repo_path: z.string().optional(),
  tech_stack: z.array(z.string()),
  scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  status: z.enum(['active', 'complete', 'paused']),
  created_at: z.number(),
  engagement_id: z.string(),
});

export const EndpointParamSchema = z.object({
  name: z.string(),
  location: z.enum(['query', 'body', 'header', 'path']),
  type: z.enum(['string', 'number', 'boolean', 'array']),
});

export const EndpointNodeSchema = z.object({
  id: z.string(),
  type: z.literal('endpoint'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']),
  path: z.string(),
  url: z.string(),
  parameters: z.array(EndpointParamSchema).optional(),
  headers: z.record(z.string()).optional(),
  auth_required: z.boolean(),
  discovered_by: z.string(),
  created_at: z.number(),
});

export const ComponentNodeSchema = z.object({
  id: z.string(),
  type: z.literal('component'),
  name: z.string(),
  version: z.string().optional(),
  fingerprint: z.string().optional(),
  discovered_at: z.number(),
});

export const VulnerabilityNodeSchema = z.object({
  id: z.string(),
  type: z.literal('vulnerability'),
  vuln_class: z.string(),
  cve: z.string().optional(),
  cvss_score: z.number().min(0).max(10).optional(),
  cvss_vector: z.string().optional(),
  cisa_kev: z.boolean().default(false),
  exploitdb_poc: z.boolean().default(false),
  description: z.string().optional(),
  affected_components: z.array(z.string()).optional(),
  created_at: z.number(),
});

export const UserNodeSchema = z.object({
  id: z.string(),
  type: z.literal('user'),
  email: z.string(),
  role: z.string().optional(),
  privileges: z.array(z.string()).optional(),
  discovered_at: z.number(),
  discovered_by: z.string(),
});

export const CredentialNodeSchema = z.object({
  id: z.string(),
  type: z.literal('credential'),
  cred_type: z.enum(['bearer', 'cookie', 'api_key', 'basic_auth', 'jwt', 'session', 'password']),
  value: z.string(), // encrypted at rest
  handle: z.string().optional(),
  scope: z.array(z.string()),
  validation_status: z.enum(['pending', 'confirmed', 'expired', 'probe_error']),
  validated_by: z.string().optional(),
  validated_at: z.number().optional(),
  created_at: z.number(),
  created_by: z.string(),
  expires_at: z.number().optional(),
});

export const MissionNodeSchema = z.object({
  id: z.string(),
  type: z.literal('mission'),
  executor: z.enum(['gamma', 'mcp']),
  exploit_type: z.string(),
  escalation_level: z.enum(['baseline', 'aggressive', 'evasive']),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  target_endpoint: z.string(),
  context_nodes: z.array(z.string()),
  credential_nodes: z.array(z.string()),
  chain_id: z.string().optional(),
  depends_on: z.array(z.string()),
  status: z.enum(['pending_verification', 'queued', 'active', 'completed', 'failed', 'archived']),
  authorized: z.boolean(),
  verified: z.boolean(),
  attempt_count: z.number(),
  created_by: z.enum(['mission_planner', 'chain_planner', 'post_exploit']),
  skip_liveness_probe: z.boolean().optional(),
  brief_node_id: z.string().nullable().optional(),
  claimed_by: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number(),
});

export const ExploitNodeSchema = z.object({
  id: z.string(),
  type: z.literal('exploit'),
  mission_id: z.string(),
  exploit_type: z.string(),
  payload: z.string(),
  target_endpoint: z.string(),
  http_status: z.number().optional(),
  response_body: z.string().optional(),
  success: z.boolean(),
  evidence: z.string().optional(),
  executed_by: z.string(),
  executed_at: z.number(),
});

export const ArtifactNodeSchema = z.object({
  id: z.string(),
  type: z.literal('artifact'),
  subtype: z.enum(['file', 'backup', 'coupon', 'nft', 'config', 'token']),
  name: z.string(),
  path: z.string().optional(),
  content_type: z.string().optional(),
  discovered_at: z.number(),
  discovered_by: z.string(),
  mission_id: z.string().optional(),
});

export const FindingNodeSchema = z.object({
  id: z.string(),
  type: z.literal('finding'),
  source: z.string(),
  target_endpoint: z.string().optional(),
  vuln_class: z.string().optional(),
  evidence: z.record(z.unknown()),
  created_at: z.number(),
});

export const ChainStepSchema = z.object({
  order: z.number(),
  mission_id: z.string(),
  action: z.string(),
  outcome: z.enum(['pending', 'success', 'failed']),
});

export const ChainNodeSchema = z.object({
  id: z.string(),
  type: z.literal('chain'),
  name: z.string(),
  chain_type: z.enum(['credential_abuse', 'idor', 'auth_escalation', 'rce_pivot']),
  steps: z.array(ChainStepSchema),
  status: z.enum(['active', 'completed', 'failed']),
  created_at: z.number(),
  created_by: z.string(),
});

export const LessonNodeSchema = z.object({
  id: z.string(),
  type: z.literal('lesson'),
  mission_id: z.string(),
  exploit_type: z.string(),
  failure_class: z.enum([
    'waf_blocked', 'wrong_endpoint', 'auth_required', 'payload_rejected',
    'target_patched', 'wrong_method', 'encoding_needed', 'session_required', 'unknown'
  ]),
  failed_payloads: z.array(z.string()),
  successful_payload: z.string().optional(),
  delta: z.string().optional(),
  reusable: z.boolean(),
  tags: z.array(z.string()),
  created_at: z.number(),
});

export const FailedMissionNodeSchema = z.object({
  id: z.string(),
  type: z.literal('failed_mission'),
  mission_id: z.string(),
  exploit_type: z.string(),
  failure_class: z.string(),
  evidence: z.record(z.unknown()),
  final_outcome: z.enum(['confirmed_unexploitable', 'needs_manual_review', 'likely_patched']),
  created_at: z.number(),
});

export const IntelNodeSchema = z.object({
  id: z.string(),
  type: z.literal('intel'),
  subtype: z.enum([
    'payload_library', 'technique_doc', 'cve_detail', 'exploit_brief',
    'tactic', 'technique', 'privesc_vector', 'attack_pattern'
  ]),
  name: z.string(),
  data: z.record(z.unknown()),
  linked_vuln_class: z.string().optional(),
  source: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number(),
});

// ===========================================
// ADVANCED NODE SCHEMAS (Phase 2+)
// ===========================================

export const BeliefUpdateSchema = z.object({
  timestamp: z.number(),
  mission_id: z.string(),
  action: z.enum(['probe', 'exploit_success', 'exploit_fail', 'waf_block', 'auth_block']),
  response: z.string(),
  delta_p_v: z.number(),
  delta_p_p: z.number(),
});

export const BeliefNodeSchema = z.object({
  id: z.string(),
  type: z.literal('belief'),
  endpoint_id: z.string(),
  vuln_class: z.string(),
  p_vulnerable: z.number().min(0).max(1),
  p_protected: z.number().min(0).max(1),
  p_exploitable: z.number().min(0).max(1),
  evidence_log: z.array(BeliefUpdateSchema),
  last_updated: z.number(),
});

export const FailedPayloadSchema = z.object({
  payload: z.string(),
  response_snippet: z.string(),
  waf_triggered: z.boolean(),
});

export const GammaHandoffNodeSchema = z.object({
  id: z.string(),
  type: z.literal('gamma_handoff'),
  mission_id: z.string(),
  from_instance: z.string(),
  to_instance: z.string().optional(),
  hypothesis: z.string(),
  confirmed_facts: z.array(z.string()),
  failed_payloads: z.array(FailedPayloadSchema),
  next_action: z.string(),
  context_budget: z.number(),
  written_at: z.number(),
  consumed_at: z.number().optional(),
});

export const BypassCandidateSchema = z.object({
  payload: z.string(),
  bypass_hypothesis: z.string(),
  result: z.enum(['success', 'failed']).optional(),
});

export const WafDuelNodeSchema = z.object({
  id: z.string(),
  type: z.literal('waf_duel'),
  mission_id: z.string(),
  waf_model: z.string(),
  bypass_candidates: z.array(BypassCandidateSchema),
  status: z.enum(['active', 'completed', 'failed']),
  created_at: z.number(),
});

export const SpecialistConfigNodeSchema = z.object({
  id: z.string(),
  type: z.literal('specialist_config'),
  surface_type: z.string(),
  parent_mission: z.string(),
  system_prompt: z.string(),
  mission_template: MissionNodeSchema,
  spawn_condition: z.string(),
  despawn_trigger: z.string(),
  created_at: z.number(),
  status: z.enum(['active', 'despawned']),
});

export const WorkingExampleSchema = z.object({
  source: z.string(),
  payload: z.string(),
  context: z.string(),
});

export const ExploitBriefNodeSchema = z.object({
  id: z.string(),
  type: z.literal('intel'),
  subtype: z.literal('exploit_brief'),
  mission_id: z.string(),
  exploit_type: z.string(),
  target_component: z.string().optional(),
  technique_summary: z.string(),
  working_examples: z.array(WorkingExampleSchema),
  known_waf_bypasses: z.array(z.string()),
  common_failures: z.array(z.string()),
  lesson_refs: z.array(z.string()),
  osint_confidence: z.enum(['high', 'medium', 'low']),
});

export const StackFingerprintSchema = z.object({
  framework: z.array(z.string()),
  auth_type: z.enum(['jwt', 'session', 'oauth2', 'api_key', 'unknown']),
  db_hints: z.array(z.string()),
  server: z.string().optional(),
});

export const CrossEngagementLessonNodeSchema = z.object({
  id: z.string(),
  type: z.literal('cross_engagement_lesson'),
  stack_fingerprint: StackFingerprintSchema,
  engagement_id: z.string(),
  target_class: z.string(),
  exploit_type: z.string(),
  failure_class: z.string().optional(),
  successful_payload: z.string().optional(),
  delta: z.string().optional(),
  reusable: z.boolean(),
  tags: z.array(z.string()),
  created_at: z.number(),
});

// ===========================================
// TYPE EXPORTS
// ===========================================

export type TargetNode = z.infer<typeof TargetNodeSchema>;
export type EndpointNode = z.infer<typeof EndpointNodeSchema>;
export type ComponentNode = z.infer<typeof ComponentNodeSchema>;
export type VulnerabilityNode = z.infer<typeof VulnerabilityNodeSchema>;
export type UserNode = z.infer<typeof UserNodeSchema>;
export type CredentialNode = z.infer<typeof CredentialNodeSchema>;
export type MissionNode = z.infer<typeof MissionNodeSchema>;
export type ExploitNode = z.infer<typeof ExploitNodeSchema>;
export type ArtifactNode = z.infer<typeof ArtifactNodeSchema>;
export type FindingNode = z.infer<typeof FindingNodeSchema>;
export type ChainNode = z.infer<typeof ChainNodeSchema>;
export type LessonNode = z.infer<typeof LessonNodeSchema>;
export type FailedMissionNode = z.infer<typeof FailedMissionNodeSchema>;
export type IntelNode = z.infer<typeof IntelNodeSchema>;
export type BeliefNode = z.infer<typeof BeliefNodeSchema>;
export type GammaHandoffNode = z.infer<typeof GammaHandoffNodeSchema>;
export type WafDuelNode = z.infer<typeof WafDuelNodeSchema>;
export type SpecialistConfigNode = z.infer<typeof SpecialistConfigNodeSchema>;
export type ExploitBriefNode = z.infer<typeof ExploitBriefNodeSchema>;
export type CrossEngagementLessonNode = z.infer<typeof CrossEngagementLessonNodeSchema>;
```

### 4.2 Edge Types

```typescript
// graph/edges.ts

export const EdgeType = {
  PART_OF: 'PART_OF',
  DEPENDS_ON: 'DEPENDS_ON',
  UNLOCKS: 'UNLOCKS',
  AUTHENTICATED_VIA: 'AUTHENTICATED_VIA',
  HAS_CREDENTIAL: 'HAS_CREDENTIAL',
  FOUND_AT: 'FOUND_AT',
  LED_TO: 'LED_TO',
  EXPLOITS: 'EXPLOITS',
  EXTRACTED_FROM: 'EXTRACTED_FROM',
  CHAINS_INTO: 'CHAINS_INTO',
  NEXT_IN_CHAIN: 'NEXT_IN_CHAIN',
  ENRICHES: 'ENRICHES',
  IMPERSONATES: 'IMPERSONATES',
  ESCALATES_TO: 'ESCALATES_TO',
  FAILED_WITH: 'FAILED_WITH',
  RESOLVED_BY: 'RESOLVED_BY',
  AFFECTS: 'AFFECTS',
  LINKED_TO: 'LINKED_TO',
  BRIEF_FOR: 'BRIEF_FOR',
  SPECIALIZES: 'SPECIALIZES',
  BELIEF_EVIDENCE: 'BELIEF_EVIDENCE',
  CLAIMED_BY: 'CLAIMED_BY',
} as const;

export type EdgeType = typeof EdgeType[keyof typeof EdgeType];

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.nativeEnum(EdgeType),
  properties: z.record(z.unknown()).optional(),
});
```

### 4.3 Memory Sections (Graph Namespaces)

FalkorDB uses key-prefixed node IDs to simulate namespaces:

```
recon/       → Nodes discovered during recon (endpoints, components, users)
              Example: "recon/endpoint:POST-/api/login"

gamma/       → Mission queue and active exploits
              Example: "gamma/mission:sqli-login-003"

bridge/      → Unvalidated credentials awaiting Commander review
              Example: "bridge/cred:jwt-unvalidated-001"

intel/       → OSINT feed data (payloads, CVEs, techniques)
              Example: "intel/payload_library:sql-injection"

lessons/     → Archived lessons and failed missions
              Example: "lessons/lesson:sqli-waf-bypass-001"

belief/      → POMDP belief state (Phase 2+)
              Example: "belief/endpoint:login:sql_injection"

specialists/ → Dynamic specialist configurations (Phase 2+)
              Example: "specialists/specialist:graphql:gamma-1"
```

### 4.4 Indexes (FalkorDB Initialization Script)

Run this on first startup to configure FalkorDB:

```typescript
// infra/falkordb-init.ts

export async function initializeFalkorDB(redis: Redis): Promise<void> {
  const indexes = [
    // Memory section prefix indexes (for namespace queries)
    { name: 'idx_recon_prefix', pattern: 'recon/*', type: 'prefix' },
    { name: 'idx_gamma_prefix', pattern: 'gamma/*', type: 'prefix' },
    { name: 'idx_bridge_prefix', pattern: 'bridge/*', type: 'prefix' },
    { name: 'idx_intel_prefix', pattern: 'intel/*', type: 'prefix' },
    { name: 'idx_lessons_prefix', pattern: 'lessons/*', type: 'prefix' },
    
    // Node type indexes
    { name: 'idx_target_type', pattern: 'target:*', type: 'exact' },
    { name: 'idx_endpoint_type', pattern: 'endpoint:*', type: 'exact' },
    { name: 'idx_mission_type', pattern: 'mission:*', type: 'exact' },
    { name: 'idx_credential_type', pattern: 'cred:*', type: 'exact' },
    { name: 'idx_vulnerability_type', pattern: 'vuln:*', type: 'exact' },
    
    // Mission queue indexes (critical for performance)
    { name: 'idx_mission_status', key: 'mission:status', type: 'hash' },
    { name: 'idx_mission_executor', key: 'mission:executor', type: 'hash' },
    { name: 'idx_mission_priority', key: 'mission:priority', type: 'hash' },
    
    // Credential indexes
    { name: 'idx_cred_validation', key: 'cred:validation_status', type: 'hash' },
    { name: 'idx_cred_type', key: 'cred:cred_type', type: 'hash' },
    
    // Vulnerability indexes
    { name: 'idx_vuln_class', key: 'vuln:vuln_class', type: 'hash' },
    { name: 'idx_vuln_cve', key: 'vuln:cve', type: 'hash' },
    
    // Intel indexes
    { name: 'idx_intel_subtype', key: 'intel:subtype', type: 'hash' },
    { name: 'idx_intel_vuln_class', key: 'intel:linked_vuln_class', type: 'hash' },
    
    // Lesson indexes
    { name: 'idx_lesson_exploit_type', key: 'lesson:exploit_type', type: 'hash' },
    { name: 'idx_lesson_failure_class', key: 'lesson:failure_class', type: 'hash' },
    
    // TTL indexes for event cleanup
    { name: 'idx_event_type', key: 'event:type', type: 'hash' },
    { name: 'idx_event_consumed', key: 'event:consumed', type: 'hash' },
    { name: 'idx_event_created_at', key: 'event:created_at', type: 'hash' },
  ];
  
  for (const idx of indexes) {
    try {
      if (idx.type === 'prefix') {
        await redis.call('FT.CREATE', idx.name, 'ON', 'hash', 'PREFIX', '1', idx.pattern);
      } else if (idx.type === 'exact') {
        await redis.call('HSET', idx.pattern, 'exists', 'true');
      } else if (idx.type === 'hash') {
        // Hash fields are automatically indexed in FalkorDB/Redis
      }
      console.log(`Index created: ${idx.name}`);
    } catch (error) {
      // Index may already exist
      console.log(`Index ${idx.name}: ${error.message}`);
    }
  }
}
```

---

## 5. Docker Compose for Local Development

```yaml
# docker-compose.yml
version: '3.8'

services:
  # FalkorDB Graph Database
  falkordb:
    image: falkordb/falkordb:latest
    container_name: solaris-falkordb
    ports:
      - "6379:6379"
    environment:
      FALKORDB_PASSWORD: falkordb_dev_password
      FALKORDB_DATABASE: 0
    volumes:
      - falkordb_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "falkordb_dev_password", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - solaris-network

  # SQLite (Event Bus) - file-based, no container needed
  # Just mount the directory where ./solaris-events.db will be created

volumes:
  falkordb_data:
    driver: local

networks:
  solaris-network:
    driver: bridge
```

**Usage:**
```bash
# Start local infrastructure
docker-compose up -d

# Verify FalkorDB is running
redis-cli -h localhost -p 6379 -a falkordb_dev_password ping

# Stop infrastructure
docker-compose down

# Stop and remove data
docker-compose down -v
```

---

## 6. Sequence Diagram: Mission Lifecycle

```
┌─────────┐    ┌────────────┐    ┌─────────┐    ┌────────┐    ┌────────┐
│  Alpha  │    │  SQLite   │    │Commander│    │Verifier│    │ Gamma  │
│  Recon  │    │ EventBus  │    │        │    │        │    │ Pool   │
└────┬────┘    └─────┬─────┘    └────┬────┘    └───┬────┘    └───┬────┘
     │               │                │              │              │
     │ Endpoint found                │              │              │
     │──────────────>│ emit finding_written              │              │
     │               │                │              │              │
     │               │──poll (500ms)─>│              │              │
     │               │                │              │              │
     │               │                │ Validate    │              │
     │               │                │──────────────>│              │
     │               │                │              │              │
     │               │                │              │ Preflight    │
     │               │                │              │ checks       │
     │               │                │              │──> OK        │
     │               │                │              │              │
     │               │                │<─── mission_verified ──────│
     │               │                │              │              │
     │               │                │ Strategic    │              │
     │               │                │ review       │              │
     │               │                │              │              │
     │               │                │─── mission_authorized ──>│
     │               │                │              │              │
     │               │                │              │   claim()    │
     │               │                │              │   atomic     │
     │               │                │              │─────────────>│
     │               │                │              │              │
     │               │                │              │   execute    │
     │               │                │              │   mission   │
     │               │                │              │              │
     │               │<──────── exploit_completed ──────│
     │               │                │              │              │
     │               │──poll ────────>│              │              │
     │               │                │ Update state│              │
     │               │                │              │              │
```

---

## 7. Graph Client Library

### 7.1 Project Structure

```
swarm-ts/src/
├── graph/
│   ├── index.ts                 # Main exports
│   ├── client.ts                 # FalkorDB connection management
│   ├── nodes.ts                 # Node creation operations
│   ├── edges.ts                  # Edge creation operations
│   ├── queries.ts               # Reusable Cypher queries
│   ├── missions.ts              # Mission queue operations
│   ├── sections.ts              # Memory section utilities
│   ├── schema.ts                # Zod schemas for validation
│   └── types.ts                 # TypeScript types (from schemas)
├── events/
│   ├── index.ts
│   ├── bus.ts                   # SQLite event bus
│   ├── types.ts                 # Event type definitions
│   ├── subscriptions.ts          # Agent subscriptions
│   └── cleanup.ts                # TTL cleanup logic
├── agents/
│   ├── commander/
│   │   ├── index.ts
│   │   ├── validation.ts         # Finding validation logic
│   │   └── mock.ts               # Mock LLM responses
│   ├── verifier/
│   │   ├── index.ts
│   │   ├── preflight-checks.ts
│   │   └── mock.ts
│   ├── gamma/
│   │   ├── index.ts
│   │   ├── pool.ts               # Gamma pool management
│   │   └── mock.ts
│   └── shared/
│       ├── base-agent.ts         # Common agent skeleton
│       └── types.ts
├── config/
│   ├── env.ts                   # Environment variable loading
│   └── defaults.ts              # Default values
├── infra/
│   ├── falkordb.ts              # FalkorDB client (ioredis wrapper)
│   ├── supabase.ts              # Supabase client
│   └── sqlite.ts                # SQLite setup
└── utils/
    ├── id.ts                    # ID generation
    ├── encryption.ts             # Credential encryption
    └── time.ts                   # Timestamp utilities
```

### 7.2 FalkorDB Client (native GRAPH.QUERY)

FalkorDB uses the Redis protocol but provides native **GRAPH.QUERY** commands with Cypher support. This gives you:
- Native graph traversals (`MATCH`, `MERGE`, `CREATE`)
- Automatic indexing
- Graph algorithms
- Relationship modeling

**Two-tier storage strategy:**
- **GRAPH.QUERY** → Nodes, edges, complex queries (graph operations)
- **Redis Hash/List** → Event TTL, agent state, simple key-value

```typescript
// infra/falkordb.ts
import Redis from 'ioredis';
import { getConfig } from '../config/env.js';

export interface FalkorDBConfig {
  host: string;
  port: number;
  password?: string;
  graphName?: string;
}

const GRAPH_NAME = 'solaris';

export class FalkorDBClient {
  private redis: Redis;
  private graphName: string;

  constructor(config: FalkorDBConfig) {
    this.graphName = config.graphName || GRAPH_NAME;
    this.redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  // ===========================================
  // GRAPH Operations (Nodes, Edges, Traversal)
  // ===========================================

  private graphQuery(
    cypher: string,
    params: Record<string, unknown>
  ): Promise<any[]> {
    // FalkorDB GRAPH.QUERY expects flat key-value args after the query
    // Flatten params: { id: 'x', props: '{}' } -> ['id', 'x', 'props', '{}']
    const flatArgs: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      flatArgs.push(key, typeof value === 'string' ? value : JSON.stringify(value));
    }

    return this.redis.call(
      'GRAPH.QUERY',
      this.graphName,
      cypher,
      ...flatArgs
    ) as Promise<any[]>;
  }

  async createNode(
    label: string,
    id: string,
    properties: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const props = {
      id,
      ...properties,
      created_at: Date.now(),
    };

    const cypher = `
      MERGE (n:${label} {id: $id})
      SET n += $props
      RETURN n
    `;

    const result = await this.graphQuery(cypher, {
      id,
      props: JSON.stringify(props),
    });

    return result[0]?.[0]?.properties || result[0]?.[0] || {};
  }

  async updateNode(
    id: string,
    properties: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const props = {
      ...properties,
      updated_at: Date.now(),
    };

    const cypher = `
      MATCH (n {id: $id})
      SET n += $props
      RETURN n
    `;

    const result = await this.graphQuery(cypher, {
      id,
      props: JSON.stringify(props),
    });

    return result[0]?.[0]?.properties || result[0]?.[0] || null;
  }

  async deleteNode(id: string): Promise<boolean> {
    const cypher = `
      MATCH (n {id: $id})
      DETACH DELETE n
      RETURN count(n) as deleted
    `;

    const result = await this.graphQuery(cypher, { id });
    return (result[0]?.[0]?.deleted || 0) > 0;
  }

  async findNodeById<T>(id: string): Promise<T | null> {
    const cypher = `
      MATCH (n {id: $id})
      RETURN n
    `;

    const result = await this.graphQuery(cypher, { id });
    const node = result[0]?.[0];
    return node ? (this.parseNode(node) as T) : null;
  }

  async findNodesByLabel<T>(
    label: string,
    filter?: Record<string, unknown>
  ): Promise<T[]> {
    let cypher = `MATCH (n:${label})`;
    const params: Record<string, unknown> = {};

    if (filter) {
      const conditions = Object.keys(filter).map((key, i) => {
        params[`k${i}`] = key;
        params[`v${i}`] = filter[key];
        return `n.${key} = $k${i}`;
      });
      cypher += ` WHERE ${conditions.join(' AND ')}`;
    }

    cypher += ' RETURN n';

    const result = await this.graphQuery(cypher, params);
    return result[0]?.map((row: any) => this.parseNode(row)) as T[] || [];
  }

  // ===========================================
  // Edge Operations
  // ===========================================

  async createEdge(
    fromId: string,
    toId: string,
    edgeType: string,
    properties?: Record<string, unknown>
  ): Promise<void> {
    const cypher = `
      MATCH (from {id: $fromId}), (to {id: $toId})
      CREATE (from)-[r:${edgeType}]->(to)
      SET r += $props
      RETURN r
    `;

    await this.graphQuery(cypher, {
      fromId,
      toId,
      props: JSON.stringify(properties || {}),
    });
  }

  async findEdges(
    fromId: string,
    edgeType?: string
  ): Promise<string[]> {
    let cypher = `MATCH (from {id: $fromId})-[r`;
    const params: Record<string, unknown> = { fromId };

    if (edgeType) {
      cypher += `:${edgeType}`;
    }

    cypher += ']->(to) RETURN to.id as id';

    const result = await this.graphQuery(cypher, params);
    return result[0]?.map((row: any) => row.id) || [];
  }

  async findEdgeWithProps(
    fromId: string,
    toId: string,
    edgeType: string
  ): Promise<Record<string, unknown> | null> {
    const cypher = `
      MATCH (from {id: $fromId})-[r:${edgeType}]->(to {id: $toId})
      RETURN r
    `;

    const result = await this.graphQuery(cypher, { fromId, toId });
    return result[0]?.[0]?.r || null;
  }

  // ===========================================
  // Graph Traversal (Native Cypher)
  // ===========================================

  async traverse(
    startId: string,
    edgeTypes: string[],
    depth: number = 3
  ): Promise<string[]> {
    const edgePattern = edgeTypes.map(e => `:${e}`).join('|');
    const cypher = `
      MATCH path = (start {id: $startId})-[:${edgePattern}*1..${depth}]->(end)
      WITH nodes(path) as ns
      UNWIND ns as n
      DISTINCT RETURN n.id as id
    `;

    const result = await this.graphQuery(cypher, { startId });
    return result[0]?.map((row: any) => row.id) || [];
  }

  async getContext(nodeId: string, depth: number = 2): Promise<Record<string, unknown>> {
    const cypher = `
      MATCH (center {id: $nodeId})
      OPTIONAL MATCH path = (center)-[*1..${depth}]-(neighbor)
      WITH center, collect(DISTINCT neighbor) as neighbors, collect(DISTINCT relationships(path)) as rels
      RETURN center, neighbors, rels
    `;

    const result = await this.graphQuery(cypher, { nodeId });
    return result[0]?.[0] || null;
  }

  // ===========================================
  // Mission Queue (Atomic Claim with Redis Lock)
  // ===========================================

  async claimMission(
    executorType: string,
    agentId: string
  ): Promise<string | null> {
    // Find unclaimed mission
    const findCypher = `
      MATCH (m:Mission {
        status: 'queued',
        verified: true,
        authorized: true,
        executor: $executorType
      })
      WHERE NOT EXISTS((m)-[:CLAIMED_BY]->(:Agent))
      RETURN m.id as id
      ORDER BY m.priority DESC, m.created_at ASC
      LIMIT 1
    `;

    const findResult = await this.graphQuery(findCypher, { executorType });
    const missionId = findResult[0]?.[0]?.id;
    if (!missionId) return null;

    // Try to acquire Redis lock for this mission
    const acquired = await this.redis.setnx(`claim:${missionId}`, agentId);
    if (!acquired) return null;

    // Set TTL on lock (5 minutes)
    await this.redis.expire(`claim:${missionId}`, 300);

    // Update mission status via GRAPH.QUERY
    const updateCypher = `
      MATCH (m:Mission {id: $missionId})
      SET m.status = 'active', m.claimed_by = $agentId, m.updated_at = $now
      RETURN m
    `;

    await this.graphQuery(updateCypher, {
      missionId,
      agentId,
      now: Date.now(),
    });

    return missionId;
  }

  // ===========================================
  // Redis KV Operations (for TTL, state, locks)
  // ===========================================

  async setKV(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl) {
      await this.redis.setex(key, ttl, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  async getKV<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async delKV(key: string): Promise<void> {
    await this.redis.del(key);
  }

  // ===========================================
  // Helpers
  // ===========================================

  private parseNode(node: any): Record<string, unknown> {
    if (!node) return {};
    if (typeof node === 'object' && node.properties) {
      return node.properties;
    }
    return node;
  }

  raw(): Redis {
    return this.redis;
  }
}

// Factory singleton
let falkordbClient: FalkorDBClient | null = null;

export function getFalkorDB(): FalkorDBClient {
  if (!falkordbClient) {
    const config = getConfig();
    falkordbClient = new FalkorDBClient({
      host: config.FALKORDB_HOST || 'localhost',
      port: parseInt(config.FALKORDB_PORT || '6379'),
      password: config.FALKORDB_PASSWORD,
      graphName: 'solaris',
    });
  }
  return falkordbClient;
}
```

### 7.3 Mission Queue Implementation

```typescript
// graph/missions.ts
import { FalkorDBClient } from '../infra/falkordb.js';
import { MissionNodeSchema, type MissionNode } from './schema.js';

export async function queueMission(
  graph: FalkorDBClient,
  mission: Omit<MissionNode, 'id' | 'status' | 'created_at' | 'updated_at'>
): Promise<MissionNode> {
  const id = `mission:${mission.exploit_type}-${mission.target_endpoint.split(':')[1] || 'unknown'}-${Date.now()}`;
  const now = Date.now();
  
  const node = await graph.createNode('Mission', id, {
    ...mission,
    id,
    status: 'pending_verification',
    created_at: now,
    updated_at: now,
  });
  
  return node as MissionNode;
}

export async function claimMission(
  graph: FalkorDBClient,
  executorType: 'gamma' | 'mcp',
  agentId: string
): Promise<MissionNode | null> {
  return await graph.claimMission(executorType, agentId) as MissionNode | null;
}

export async function completeMission(
  graph: FalkorDBClient,
  missionId: string,
  result: { success: boolean; evidence?: string }
): Promise<void> {
  await graph.updateNode(missionId, {
    status: result.success ? 'completed' : 'failed',
    updated_at: Date.now(),
    ...(result.evidence && { evidence: result.evidence }),
  });
}

export async function failMission(
  graph: FalkorDBClient,
  missionId: string,
  error: string
): Promise<void> {
  await graph.updateNode(missionId, {
    status: 'failed',
    updated_at: Date.now(),
    error,
  });
}

export async function getActiveMissions(
  graph: FalkorDBClient,
  executorType?: string
): Promise<MissionNode[]> {
  const filter = executorType 
    ? { status: 'active', executor: executorType }
    : { status: 'active' };
  
  return await graph.findNodesByLabel<MissionNode>('Mission', filter);
}

export async function getQueuedMissions(
  graph: FalkorDBClient,
  executorType?: string
): Promise<MissionNode[]> {
  const filter = executorType 
    ? { status: 'queued', executor: executorType }
    : { status: 'queued' };
  
  return await graph.findNodesByLabel<MissionNode>('Mission', filter);
}
```

---

## 8. Event Bus (SQLite)

### 8.1 Event Schema

```typescript
// events/types.ts

export type SwarmEventType =
  | "finding_written"
  | "finding_validated"
  | "credential_found"
  | "credential_promoted"
  | "mission_queued"
  | "mission_verified"
  | "mission_authorized"
  | "exploit_completed"
  | "exploit_failed"
  | "enrichment_requested"
  | "rce_confirmed"
  | "swarm_complete"
  | "brief_ready"
  | "waf_duel_started"
  | "waf_duel_complete"
  | "handoff_requested"
  | "specialist_activated"
  | "specialist_complete"
  | "belief_updated";

export interface SwarmEvent {
  id: string;
  type: SwarmEventType;
  payload: Record<string, unknown>;
  consumed: boolean;
  consumed_by?: string;
  consumed_at?: number;
  created_at: number;
  created_by: string;
}

export const EventTTL: Record<SwarmEventType, number | null> = {
  swarm_complete: null,
  finding_validated: 3600000,
  mission_authorized: 3600000,
  exploit_completed: 3600000,
  exploit_failed: 86400000,
  brief_ready: 1800000,
  finding_written: 600000,
  credential_found: 600000,
  credential_promoted: 600000,
  mission_queued: 600000,
  mission_verified: 600000,
  enrichment_requested: 600000,
  rce_confirmed: 600000,
  waf_duel_started: 600000,
  waf_duel_complete: 600000,
  handoff_requested: 600000,
  specialist_activated: 600000,
  specialist_complete: 600000,
  belief_updated: 600000,
};
```

### 8.2 Event Bus API

```typescript
// events/bus.ts
import Database from 'better-sqlite3';
import { SwarmEvent, SwarmEventType, EventTTL } from './types.js';

export class EventBus {
  private db: Database.Database;
  private cleanupStmt: Database.Statement;
  
  constructor(dbPath?: string) {
    this.db = new Database(dbPath || './solaris-events.db');
    this.initialize();
    this.cleanupStmt = this.db.prepare(`
      DELETE FROM events 
      WHERE consumed = 1 
        AND consumed_at < ?
        AND type NOT IN ('swarm_complete')
    `);
  }
  
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        consumed INTEGER DEFAULT 0,
        consumed_by TEXT,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_consumed ON events(consumed);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    `);
  }
  
  async emit(type: SwarmEventType, payload: Record<string, unknown>, createdBy: string): Promise<string> {
    const id = `evt:${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    await this.db.prepare(`
      INSERT INTO events (id, type, payload, consumed, created_at, created_by)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(id, type, JSON.stringify(payload), Date.now(), createdBy);
    
    return id;
  }
  
  async consume(
    agentId: string,
    subscriptions: SwarmEventType[],
    limit = 20
  ): Promise<SwarmEvent[]> {
    const placeholders = subscriptions.map(() => '?').join(',');
    
    // Use a transaction for consume
    const consumeTx = this.db.transaction(() => {
      const stmt = this.db.prepare(`
        SELECT * FROM events 
        WHERE consumed = 0 
          AND type IN (${placeholders})
        ORDER BY created_at ASC
        LIMIT ?
      `);
      
      const events = stmt.all(...subscriptions, limit) as any[];
      
      if (events.length === 0) return [];
      
      const updateStmt = this.db.prepare(`
        UPDATE events 
        SET consumed = 1, consumed_by = ?, consumed_at = ?
        WHERE id = ? AND consumed = 0
      `);
      
      const now = Date.now();
      for (const event of events) {
        updateStmt.run(agentId, now, event.id);
      }
      
      return events.map(e => ({
        ...e,
        payload: JSON.parse(e.payload),
        consumed: Boolean(e.consumed),
      }));
    });
    
    return consumeTx();
  }
  
  async getPendingCount(subscriptions: SwarmEventType[]): Promise<number> {
    const placeholders = subscriptions.map(() => '?').join(',');
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM events 
      WHERE consumed = 0 AND type IN (${placeholders})
    `).get(...subscriptions) as { count: number };
    return result.count;
  }
  
  async cleanup(): Promise<number> {
    const cutoff = Date.now() - 600000; // 10 min default
    const result = this.cleanupStmt.run(cutoff);
    return result.changes;
  }
  
  async getOrphanedEvents(olderThanMs: number = 600000): Promise<SwarmEvent[]> {
    const cutoff = Date.now() - olderThanMs;
    const events = this.db.prepare(`
      SELECT * FROM events 
      WHERE consumed = 0 AND created_at < ?
      ORDER BY created_at ASC
    `).all(cutoff) as any[];
    
    return events.map(e => ({
      ...e,
      payload: JSON.parse(e.payload),
      consumed: Boolean(e.consumed),
    }));
  }
  
  close(): void {
    this.db.close();
  }
}
```

### 8.3 Agent Event Polling

```typescript
// agents/shared/base-agent.ts
import { EventBus } from '../../events/bus.js';
import { getFalkorDB, FalkorDBClient } from '../../infra/falkordb.js';
import type { SwarmEvent, SwarmEventType } from '../../events/types.js';

export abstract class BaseAgent {
  protected agentId: string;
  protected subscriptions: SwarmEventType[];
  protected pollInterval: number;
  protected eventBus: EventBus;
  protected graph: FalkorDBClient;
  protected running: boolean = false;
  protected pollTimer?: ReturnType<typeof setInterval>;
  
  constructor(
    agentId: string,
    subscriptions: SwarmEventType[],
    pollInterval: number,
    eventBus: EventBus,
    graph: FalkorDBClient
  ) {
    this.agentId = agentId;
    this.subscriptions = subscriptions;
    this.pollInterval = pollInterval;
    this.eventBus = eventBus;
    this.graph = graph;
  }
  
  start(): void {
    this.running = true;
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
  }
  
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }
  
  private async poll(): Promise<void> {
    if (!this.running) return;
    
    try {
      const events = await this.eventBus.consume(this.agentId, this.subscriptions);
      
      for (const event of events) {
        await this.handleEvent(event);
      }
    } catch (error) {
      console.error(`[${this.agentId}] Poll error:`, error);
    }
  }
  
  protected abstract handleEvent(event: SwarmEvent): Promise<void>;
}
```

---

## 9. Agent Skeletons (Mocked)

### 9.1 Commander Agent

```typescript
// agents/commander/index.ts
import { BaseAgent } from '../shared/base-agent.js';
import { EventBus } from '../../events/bus.js';
import { getFalkorDB } from '../../infra/falkordb.js';
import type { SwarmEvent, FindingNode, MissionNode } from '../../events/types.js';
import { FindingNodeSchema, MissionNodeSchema } from '../../graph/schema.js';

export class CommanderAgent extends BaseAgent {
  constructor(eventBus: EventBus) {
    super(
      'commander',
      ['finding_written', 'mission_verified', 'exploit_completed', 'exploit_failed'],
      500,
      eventBus,
      getFalkorDB()
    );
  }
  
  protected async handleEvent(event: SwarmEvent): Promise<void> {
    switch (event.type) {
      case 'finding_written':
        await this.validateFinding(event.payload);
        break;
      case 'mission_verified':
        await this.authorizeMission(event.payload);
        break;
      case 'exploit_completed':
        await this.handleExploitComplete(event.payload);
        break;
      case 'exploit_failed':
        await this.handleExploitFailed(event.payload);
        break;
    }
  }
  
  private async validateFinding(payload: Record<string, unknown>): Promise<void> {
    const finding = payload.finding as FindingNode;
    
    // Mock validation - for MVP, always passes
    const passesValidation = true;
    
    if (passesValidation) {
      await this.graph.updateNode(finding.id, { 
        validated: true,
        validated_at: Date.now(),
      });
      await this.eventBus.emit('finding_validated', { finding_id: finding.id }, this.agentId);
    }
  }
  
  private async authorizeMission(payload: Record<string, unknown>): Promise<void> {
    const { mission_id } = payload as { mission_id: string };
    
    await this.graph.updateNode(mission_id, { authorized: true });
    await this.eventBus.emit('mission_authorized', { mission_id }, this.agentId);
  }
  
  private async handleExploitComplete(payload: Record<string, unknown>): Promise<void> {
    const { mission_id, result } = payload as { mission_id: string; result: any };
    await this.graph.updateNode(mission_id, { status: 'completed', result });
  }
  
  private async handleExploitFailed(payload: Record<string, unknown>): Promise<void> {
    const { mission_id, error } = payload as { mission_id: string; error: string };
    await this.graph.updateNode(mission_id, { status: 'failed', error });
  }
  
  protected mockLLMResponse(prompt: string): string {
    return `[MOCK COMMANDER] Processed: ${prompt.slice(0, 50)}...`;
  }
}
```

### 9.2 Verifier Agent

```typescript
// agents/verifier/index.ts
import { BaseAgent } from '../shared/base-agent.js';
import { EventBus } from '../../events/bus.js';
import { getFalkorDB } from '../../infra/falkordb.js';
import type { SwarmEvent } from '../../events/types.js';

export class VerifierAgent extends BaseAgent {
  constructor(eventBus: EventBus) {
    super(
      'verifier',
      ['mission_queued'],
      500,
      eventBus,
      getFalkorDB()
    );
  }
  
  protected async handleEvent(event: SwarmEvent): Promise<void> {
    const { mission_id } = event.payload as { mission_id: string };
    await this.verifyMission(mission_id);
  }
  
  private async verifyMission(missionId: string): Promise<void> {
    const checks = {
      endpoint_alive: true,
      schema_valid: true,
      payload_coherent: true,
      context_satisfied: true,
      not_duplicate: true,
      scope_compliant: true,
    };
    
    const allPassed = Object.values(checks).every(v => v);
    
    await this.graph.updateNode(missionId, { 
      verified: allPassed,
      status: allPassed ? 'queued' : 'archived',
    });
    
    await this.eventBus.emit('mission_verified', { mission_id: missionId, passed: allPassed }, this.agentId);
  }
}
```

### 9.3 Gamma Agent (Pool)

```typescript
// agents/gamma/index.ts
import { BaseAgent } from '../shared/base-agent.js';
import { EventBus } from '../../events/bus.js';
import { getFalkorDB } from '../../infra/falkordb.js';
import { claimMission, completeMission } from '../../graph/missions.js';
import type { SwarmEvent, MissionNode } from '../../events/types.js';

export class GammaAgent extends BaseAgent {
  private poolId: string;
  
  constructor(poolId: string, eventBus: EventBus) {
    super(
      `gamma-${poolId}`,
      ['mission_authorized', 'brief_ready'],
      2000,
      eventBus,
      getFalkorDB()
    );
    this.poolId = poolId;
  }
  
  protected async handleEvent(event: SwarmEvent): Promise<void> {
    switch (event.type) {
      case 'mission_authorized':
        await this.executeMission(event.payload);
        break;
      case 'brief_ready':
        break;
    }
  }
  
  private async executeMission(payload: Record<string, unknown>): Promise<void> {
    const { mission_id } = payload as { mission_id: string };
    
    const mission = await claimMission(this.graph, 'gamma', this.agentId);
    if (!mission) return;
    
    const result = await this.mockExecute(mission);
    
    await this.graph.createNode('exploit', `${mission_id}-attempt-1`, {
      mission_id,
      exploit_type: (mission as any).exploit_type,
      payload: 'MOCK_PAYLOAD',
      target_endpoint: (mission as any).target_endpoint,
      success: result.success,
      executed_by: this.agentId,
      executed_at: Date.now(),
    });
    
    await completeMission(this.graph, mission_id, result);
    
    await this.eventBus.emit(
      result.success ? 'exploit_completed' : 'exploit_failed',
      { mission_id, result },
      this.agentId
    );
  }
  
  private async mockExecute(mission: MissionNode): Promise<{ success: boolean }> {
    return { success: Math.random() > 0.5 };
  }
}
```

---

## 10. Implementation Phases

### Phase 1: Graph Foundation (This MVP)
- [x] FalkorDB schema design
- [x] Zod schema validation (updated from interfaces)
- [x] FalkorDB client (ioredis wrapper)
- [ ] SQLite event bus (`events/`)
- [ ] Agent base skeleton
- [ ] Mission queue implementation
- [ ] Supabase integration
- [ ] Configuration management
- [ ] Docker-compose for local dev
- [ ] Basic tests

### Phase 2: Core Agents
- [ ] Commander agent (finding validation)
- [ ] Verifier agent (preflight checks)
- [ ] Mission Planner agent (mocked LLM)
- [ ] Gamma pool (1 instance)
- [ ] Event flow integration

### Phase 3: Full Agent Roster
- [ ] Alpha Recon agent
- [ ] OSINT agent
- [ ] MCP Agent
- [ ] Chain Planner
- [ ] Critic agent
- [ ] Post-Exploit agent

### Phase 4: LLM Integration
- [ ] Ollama integration
- [ ] Cloud provider routing
- [ ] LLM Router module
- [ ] Prompt templates
- [ ] Response parsing

### Phase 5: Advanced Features (14a-14g)
- [ ] 14a: POMDP Belief State
- [ ] 14b: WAF Duel Self-Play
- [ ] 14c: Context Relay Protocol
- [ ] 14d: Cross-Engagement Lessons
- [ ] 14e: Semantic Novelty Scoring
- [ ] 14f: Causal Failure Attribution
- [ ] 14g: Dynamic Specialist Spawning

---

## 11. Testing Strategy

### 11.1 Unit Tests

```typescript
// tests/graph/client.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FalkorDBClient } from '../../src/infra/falkordb';

describe('FalkorDBClient', () => {
  let client: FalkorDBClient;
  
  beforeEach(async () => {
    client = new FalkorDBClient({
      host: 'localhost',
      port: 6379,
      password: 'test',
    });
    await client.connect();
  });
  
  it('should create and retrieve a node', async () => {
    const node = await client.createNode('Target', 'test', {
      name: 'Test Target',
      base_url: 'http://localhost:3000',
    });
    
    expect(node.id).toBe('test');
    expect(node.name).toBe('Test Target');
    
    const retrieved = await client.findNodeById('test');
    expect(retrieved?.name).toBe('Test Target');
  });
  
  it('should query nodes by label', async () => {
    await client.createNode('Target', 'test1', { name: 'Test 1' });
    await client.createNode('Target', 'test2', { name: 'Test 2' });
    
    const nodes = await client.findNodesByLabel('Target');
    expect(nodes.length).toBeGreaterThanOrEqual(2);
  });
  
  it('should update a node', async () => {
    await client.createNode('Target', 'test', { name: 'Original' });
    const updated = await client.updateNode('test', { name: 'Updated' });
    expect(updated.name).toBe('Updated');
  });
});

describe('MissionQueue', () => {
  it('should claim unclaimed mission atomically', async () => {
    const graph = new FalkorDBClient({ host: 'localhost', port: 6379 });
    
    await graph.createNode('Mission', 'sqli-001', {
      executor: 'gamma',
      exploit_type: 'sqli',
      status: 'queued',
      verified: true,
      authorized: true,
    });
    
    const claimed = await graph.claimMission('gamma', 'gamma-1');
    expect(claimed).toBe('mission:sqli-001');
    
    const secondClaim = await graph.claimMission('gamma', 'gamma-2');
    expect(secondClaim).toBeNull();
  });
});
```

### 11.2 Integration Tests

```typescript
// tests/integration/event-flow.test.ts
describe('Event-Driven Mission Flow', () => {
  it('should complete full mission lifecycle', async () => {
    const eventBus = new EventBus(':memory:');
    const graph = new FalkorDBClientImpl({ host: 'localhost', port: 6379 });
    
    // 1. Alpha Recon discovers endpoint
    await graph.createNode('Endpoint', 'GET-/api/users', {
      method: 'GET',
      path: '/api/users',
      url: 'http://localhost:3000/api/users',
      auth_required: false,
      discovered_by: 'alpha-recon',
      created_at: Date.now(),
    });
    
    await eventBus.emit('finding_written', { 
      finding: { id: 'endpoint:GET-/api/users', type: 'endpoint' }
    }, 'alpha-recon');
    
    // 2. Simulate event polling and handling
    const events = await eventBus.consume('commander', ['finding_written']);
    expect(events.length).toBe(1);
    
    // 3. Create and queue mission
    await graph.createNode('Mission', 'sqli-001', {
      executor: 'gamma',
      exploit_type: 'sqli',
      target_endpoint: 'endpoint:GET-/api/users',
      status: 'pending_verification',
      verified: false,
      authorized: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    
    await eventBus.emit('mission_queued', { mission_id: 'mission:sqli-001' }, 'mission-planner');
    
    // 4. Verify mission
    await graph.updateNode('mission:sqli-001', { 
      verified: true, 
      status: 'queued',
      updated_at: Date.now(),
    });
    await eventBus.emit('mission_verified', { mission_id: 'mission:sqli-001', passed: true }, 'verifier');
    
    // 5. Authorize mission
    await graph.updateNode('mission:sqli-001', { 
      authorized: true,
      updated_at: Date.now(),
    });
    await eventBus.emit('mission_authorized', { mission_id: 'mission:sqli-001' }, 'commander');
    
    // 6. Gamma claims and executes
    const claimedId = await graph.claimMission('gamma', 'gamma-1');
    expect(claimedId).toBe('mission:sqli-001');
    
    await graph.updateNode('mission:sqli-001', { 
      status: 'completed',
      updated_at: Date.now(),
    });
    await eventBus.emit('exploit_completed', { mission_id: 'mission:sqli-001', result: { success: true } }, 'gamma-1');
    
    // 7. Verify final state
    const finalMission = await graph.findNodeById('mission:sqli-001');
    expect(finalMission?.status).toBe('completed');
  });
});
```

---

## 12. File Manifest

```
agent-swarm/
├── src/
│   ├── graph/
│   │   ├── index.ts                 # Exports
│   │   ├── nodes.ts                 # Node CRUD operations
│   │   ├── edges.ts                 # Edge CRUD operations
│   │   ├── queries.ts               # Reusable queries
│   │   ├── missions.ts              # Mission queue operations
│   │   ├── sections.ts             # Memory section helpers
│   │   ├── schema.ts               # Zod schemas for validation
│   │   └── types.ts                # TypeScript types (from schemas)
│   ├── events/
│   │   ├── index.ts
│   │   ├── bus.ts                   # SQLite EventBus class
│   │   ├── types.ts                 # Event types + TTL
│   │   ├── subscriptions.ts         # Subscription helpers
│   │   └── cleanup.ts               # TTL cleanup logic
│   ├── agents/
│   │   ├── base-agent.ts            # BaseAgent abstract class
│   │   ├── commander/
│   │   │   ├── index.ts
│   │   │   └── validation.ts
│   │   ├── verifier/
│   │   │   └── index.ts
│   │   └── gamma/
│   │       ├── index.ts
│   │       └── pool.ts
│   ├── infra/
│   │   ├── falkordb.ts            # FalkorDB client (ioredis)
│   │   ├── falkordb-init.ts        # FalkorDB initialization script
│   │   ├── supabase.ts            # Supabase client
│   │   └── sqlite.ts               # SQLite setup
│   ├── config/
│   │   └── index.ts               # Env validation (Zod)
│   └── utils/
│       ├── id.ts                   # ID generators
│       └── time.ts
├── tests/
│   ├── graph/
│   │   └── client.test.ts
│   └── integration/
│       └── event-flow.test.ts
├── docker-compose.yml             # Local dev infrastructure
├── .env.example                  # Environment template
└── package.json
```

---

## 13. Dependencies

```json
{
  "dependencies": {
    "ioredis": "^5.3.0",        # FalkorDB client (Redis protocol)
    "better-sqlite3": "^9.0.0",  # SQLite for event bus
    "@supabase/supabase-js": "^2.39.0",  # Already in project
    "zod": "^3.22.0"            # Already in project
  }
}
```

---

## 14. Success Criteria

1. **Graph Operations**: All node types can be created, read, updated, deleted
2. **Mission Queue**: Missions can be queued, claimed atomically, completed
3. **Event Bus**: Events emit, consume works, agents receive events
4. **Memory Sections**: Nodes correctly namespaced by section
5. **Agent Polling**: Agents poll events at correct intervals
6. **Supabase Sync**: Engagement data persists to Supabase
7. **Type Safety**: Full TypeScript coverage with Zod validation
8. **Tests Pass**: Unit and integration tests green
9. **TTL Cleanup**: Event bus doesn't grow unbounded

---

## 15. Next Steps

1. Create `agent-swarm/src/graph/schema.ts` with all Zod schemas
2. Implement `agent-swarm/src/infra/falkordb.ts` FalkorDB client (ioredis)
3. Implement `agent-swarm/src/events/bus.ts` SQLite event bus
4. Create `agent-swarm/src/events/cleanup.ts` TTL cleanup
5. Set up Railway FalkorDB and add credentials to `agent-swarm/.env`
6. Implement mission queue in `agent-swarm/src/graph/missions.ts`
7. Create base agent skeleton in `agent-swarm/src/agents/base-agent.ts`
8. Implement mocked Commander, Verifier, Gamma agents
9. Write tests for core functionality
10. Add Supabase integration for persistence

---

## Appendix A: FalkorDB GRAPH.QUERY Parameter Format

FalkorDB's `GRAPH.QUERY` command takes parameters differently than standard Redis:

```bash
# Correct parameter passing - parameters are key-value pairs after the query
GRAPH.QUERY mygraph "
  MERGE (n:Person {id: $id})
  SET n += $props
" ID "person-123" PROPS '{"name": "Alice", "age": 30}'

# Note: Parameters are NOT JSON - they're individual key-value arguments
# The $id and $props are placeholders that reference the passed parameters
```

**Parameter Types:**
| Type | Example | Notes |
|------|---------|-------|
| String | `NAME "Alice"` | Plain string |
| Integer | `AGE 30` | No quotes |
| Float | `SCORE 3.14` | No quotes |
| Boolean | `ACTIVE true` | No quotes |
| Array/JSON | `DATA '{"key": "value"}'` | JSON string |

**ioredis wrapper handling:**
```typescript
// The FalkorDBClient wraps GRAPH.QUERY with proper parameter handling
// Parameters are passed as a plain object, then formatted as KV pairs
await redis.call('GRAPH.QUERY', graphName, cypher, {
  id: 'person-123',
  props: JSON.stringify({ name: 'Alice', age: 30 }),
});
```

---

## Appendix B: FalkorDB Redis Protocol Compatibility

FalkorDB is built on Redis with Graph extensions. Key compatibility notes:

| Feature | Redis | FalkorDB | Notes |
|---------|-------|----------|-------|
| Connection | TCP 6379 | Same | Uses Redis protocol |
| Authentication | `AUTH` | Same | `FALKORDB_PASSWORD` |
| Data types | String, Hash, Set, List, etc. | Same + Graph | All Redis types work |
| Graph queries | N/A | `GRAPH.QUERY`, `GRAPH.RO` | Cypher-like syntax |
| Search | RediSearch | Same | Full-text search available |
| Persistence | RDB/AOF | Same | Standard Redis persistence |

**Example FalkorDB Graph Commands:**
```bash
# Create a graph with parameters
GRAPH.QUERY solaris "
  MERGE (n:Person {id: $id})
  SET n += $props
" ID "alice-001" PROPS '{"name": "Alice", "role": "admin"}'

# Query with MATCH
GRAPH.QUERY solaris "
  MATCH (m:Mission {status: 'queued', executor: $executorType})
  WHERE NOT EXISTS((m)-[:CLAIMED_BY]->(:Agent))
  RETURN m.id as id
" EXECUTORTYPE "gamma"

# Traverse relationships
GRAPH.QUERY solaris "
  MATCH path = (start {id: $startId})-[:UNLOCKS|DEPENDS_ON*1..3]->(end)
  RETURN end.id
" STARTID "mission:sqli-001"
```

---

## Appendix B: Connection Pooling Configuration

For production, configure connection pooling:

```typescript
// infra/falkordb-pool.ts
import Redis from 'ioredis';

export interface PoolConfig {
  min: number;
  max: number;
  acquireTimeout: number;
  idleTimeout: number;
}

// For MVP, single connection is fine
// For production, consider ioredis cluster or connection pool
```

---

*Document Version: 1.1 | Status: Updated with corrections*
