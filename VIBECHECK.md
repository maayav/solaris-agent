# VibeCheck Module Analysis Report

## Module: `vibecheck/`

---

## 1. Current Stack & Dependencies

### Core Framework
| Technology | Version | Notes |
|---|---|---|
| Python | 3.12+ | Runtime |
| FastAPI | 0.115+ | Web framework |
| Uvicorn | 0.30+ | ASGI server |
| Pydantic | 2.x | Data validation |
| pydantic-settings | 2.x | Environment config |

### Data Stores
| Technology | Purpose | Notes |
|---|---|---|
| FalkorDB | Graph knowledge base | Stores code relationships, vulnerability patterns |
| Qdrant | Vector database | Semantic similarity search, pattern propagation |
| Redis | Streams + FalkorDB client | `scan_queue`, `a2a_messages`, `red_team_events`, `defense_analytics` |
| Supabase | PostgreSQL persistence | Projects, scan_queue, vulnerabilities, swarm tables |

### Parsing & Analysis
| Technology | Purpose | Notes |
|---|---|---|
| Tree-Sitter | Code parsing | Supports JS, TS, Python — creates CST for analysis |
| Semgrep | Static analysis | Rule-based vulnerability detection |

### LLM Integration
| Technology | Notes |
|---|---|
| Ollama | Local LLM inference |
| httpx | Async HTTP client for Ollama |

### Database Clients
| Technology | Purpose |
|---|---|
| `falkordb` (async) | Async FalkorDB driver |
| `redis` (async) | Async Redis client |
| `supabase` (async) | Async Supabase client |
| `qdrant-client` | Vector DB client |

### Agents
| Technology | Notes |
|---|---|
| Red Team Agent | Offensive — placeholder module |
| Analyst (Blue Team) | Defensive — placeholder module |

### Utilities
| Library | Purpose |
|---|---|
| Structlog | Structured logging |
| Tenacity | Retry logic |
| GitPython | Git repository cloning |
| aiofiles | Async file I/O |
| asyncio-pool | Async task pooling |

### Dashboard
| Technology | Notes |
|---|---|
| Angular.js | **QUIET LIABILITY** — legacy dashboard frontend (separate from `swarm module/frontend/`), no clear ownership, no active development, Angular.js 1.x — should be replaced alongside this refactor |

---

## 2. Processing Pipeline / Data Flow

### Blue Team Pipeline (9 Stages)

```
Stage 1: Clone Repository         →  5%
         ↓
Stage 2: Tree-Sitter Parse        → 15%
         ↓
Stage 3: FalkorDB Knowledge Graph  → 25%
         (code relationships, function calls, imports)
         ↓
Stage 4: N+1 Query Detector       → 35%
         (static analysis for database query patterns)
         ↓
Stage 5: Semgrep Static Analysis  → 50%
         (rule-based vulnerability scanning)
         ↓
Stage 6: Semantic Lifting         → 65%
         (Ollama LLM adds semantic context to findings)
         ↓
Stage 7: LLM Verification         → 70-95%
         (Two-tier: deterministic rules → LLM for ambiguous cases)
         ↓
Stage 8: Pattern Propagation     → ~80%
         (Qdrant similarity search spreads findings across codebase)
         ↓
Stage 9: Supabase Storage
         (persist results to database)
```

### Worker Architecture

| Worker | Responsibility |
|---|---|
| `scan_worker` | Main pipeline orchestrator (1100+ lines) |
| `semgrep_runner` | Runs Semgrep rules against parsed code |
| `llm_verifier` | Two-tier vulnerability verification |
| `semantic_lifter` | Ollama-based semantic enrichment |

### Redis Streams

| Stream | Purpose |
|---|---|
| `scan_queue` | Job distribution to workers |
| `a2a_messages` | Agent-to-agent messaging |
| `red_team_events` | Red team activity events |
| `defense_analytics` | **Blue team findings for Red Team bridge** — ⚠️ stream contract must be versioned and locked before independent rewrite |

### Blue Team → Red Team Bridge
- Blue Team findings flow through `defense_analytics` stream
- Enriches Red Team reconnaissance with static analysis intel

---

## 3. Architecture

### Directory Structure

```
vibecheck/
├── api/
│   └── main.py              # FastAPI endpoints (9+ routes)
├── agents/
│   ├── redteam.py           # Red team agent (placeholder)
│   └── analyst.py            # Blue team agent (placeholder)
├── core/
│   ├── parser.py            # Tree-Sitter code parsing
│   ├── falkordb.py          # FalkorDB graph client
│   ├── qdrant.py            # Qdrant vector client
│   ├── supabase_client.py   # Async Supabase wrapper
│   ├── redis_bus.py          # Redis Streams messaging
│   └── ollama_client.py     # Ollama LLM client
├── worker/
│   ├── scan_worker.py       # Main Blue Team pipeline (1100+ lines)
│   ├── semgrep_runner.py    # Semgrep static analysis
│   ├── llm_verifier.py      # Two-tier LLM verification
│   └── semantic_lifter.py   # Semantic enrichment
├── rules/
│   └── *.yaml               # Pattern detection rules
├── dashboard/               # Angular.js dashboard — QUIET LIABILITY
├── migrations/               # 4 SQL migrations
│   ├── 0001_initial.sql
│   ├── 0002_agents.sql
│   ├── 0003_swarm.sql
│   └── 0004_additional.sql
├── fixtures/
├── tests/
├── analyze_routes.py
├── claim_pending.py
└── requirements.txt
```

### Database Schema (4 Migrations)

| Table | Purpose |
|---|---|
| `projects` | Repository projects under scan |
| `scan_queue` | Pending/in-progress scan jobs |
| `vulnerabilities` | Found vulnerability records |
| `swarm_*` tables | Swarm mission data |

### API Endpoints (9+ routes in `api/main.py`)

- Project management
- Scan initiation/tracking
- Report retrieval
- Swarm mission control
- Chat/RabbitMQ integration
- Dashboard data

### Key Files

| File | Lines | Purpose |
|---|---|---|
| `worker/scan_worker.py` | 1100+ | Main Blue Team pipeline orchestrator |
| `core/parser.py` | ~400 | Tree-Sitter CST generation |
| `core/falkordb.py` | ~300 | Graph DB operations |
| `core/qdrant.py` | ~200 | Vector similarity search |
| `core/supabase_client.py` | ~500 | Async DB persistence |
| `core/redis_bus.py` | ~300 | Stream-based messaging |
| `worker/semgrep_runner.py` | ~300 | Static analysis runner |
| `worker/llm_verifier.py` | ~400 | Two-tier verification |
| `api/main.py` | ~500 | FastAPI endpoints |

---

## 4. Refactoring Notes: TypeScript + Hono + Bun

### 🔄 Full Rewrite Required

| Current | Target | Notes |
|---|---|---|
| Python 3.12 | TypeScript | Entire codebase needs rewriting |
| FastAPI | Hono | REST API framework replacement |
| Pydantic v2 | Zod | Schema validation replacement |

### ✅ Portable Dependencies

| Dependency | TypeScript/Bun Alternative | Status |
|---|---|---|
| Redis | `ioredis` | Direct port — same API |
| Qdrant | `qdrant-js-client` | Official JS client exists |
| Supabase | `@supabase/supabase-js` | Already used in frontend |
| Ollama | `ollama` npm package | Official JS client |
| httpx | Native fetch / `ofetch` | Replace async HTTP calls |

### ⚠️ Problematic Dependencies

| Dependency | Problem | Solution |
|---|---|---|
| **FalkorDB** | No native TypeScript/JS driver | Replace with **Neo4j** (has official JS driver). openCypher queries exist in both DBs — tractable but requires full schema + query rewrite. Do this in Phase 5. |
| **Tree-Sitter** | `@tree-sitter/` packages exist but less mature than Python bindings | Available for Bun, but JS bindings need validation testing — prototype Stage 6 first |
| **Semgrep** | No JS/TS equivalent | Wrap Semgrep CLI — **⚠️ subprocess overhead at scale**: each Semgrep run spawns a new process. At high scan volume this becomes a bottleneck. Consider Semgrep Cloud API as alternative for production scale. |
| **GitPython** | No direct JS equivalent | Use `simple-git` or `isomorphic-git` |
| **Structlog** | Python-only | Bun native structured logging via `Bunyan` or custom |
| **Angular.js dashboard** | **QUIET LIABILITY** — legacy, no active ownership, Angular.js 1.x | Replace with React (aligned with frontend module) in Phase 10 |

### 🚨 Cross-Module Stream Contract Warning

The `defense_analytics` stream is a **shared contract** between VibeCheck (Blue Team) and Swarm (Red Team). Before rewriting either module independently:
1. **Version and lock** the `defense_analytics` stream schema (field names, types, producer/consumer roles)
2. Any field rename or type change in Blue Team will break Red Team's `blue_team_bridge.py`
3. Establish a stream contract test that validates message shape on both sides
4. This coordination must happen **before** Phase 2 (Redis Streams port) in both modules

### Architecture Translation

| Python Pattern | TypeScript Pattern |
|---|---|
| FastAPI + Pydantic | Hono + Zod |
| Worker processes | Async task queues (BullMQ or similar) |
| Redis Streams | Redis Streams via `ioredis` |
| Pydantic models | Zod schemas |
| Decorators | TypeScript decorators or higher-order functions |
| `withActivityLog` decorator | Hono middleware |

### Pipeline Translation

| Stage | Python Implementation | TS/Bun Alternative |
|---|---|---|
| Clone | GitPython | `simple-git` / `isomorphic-git` |
| Parse | Tree-Sitter | `@tree-sitter/parser` |
| Graph DB | FalkorDB | **Neo4j** (no FalkorDB JS driver) — openCypher port |
| Static Analysis | Semgrep | Semgrep CLI wrapper — **⚠️ subprocess overhead at scale** |
| LLM | Ollama + httpx | `ollama` npm package |
| Vector DB | Qdrant | `qdrant-js-client` |
| Persistence | Supabase | `@supabase/supabase-js` |
| Messaging | Redis Streams | `ioredis` Streams |

### Gaps

| Gap | Problem | Recommendation |
|---|---|---|
| No JS FalkorDB driver | Graph DB choice | Switch to Neo4j (official JS driver) or build HTTP abstraction layer |
| Semgrep CLI subprocess overhead | Performance at scale | Prototype early; if overhead is unacceptable, use Semgrep Cloud API |
| Tree-Sitter maturity | JS bindings less mature | Test thoroughly, may need Python fallback for parsing |
| Agent system | Placeholder modules | Need to design TypeScript agent framework |
| Angular.js dashboard | **Quiet liability**, no ownership | Replace with React (aligned with frontend module) — recommended early, but pragmatically deprioritized to Phase 10 to focus resources on the core pipeline refactor first |
| `defense_analytics` stream contract | Cross-module coordination | Version and lock stream schema before Phase 2 |

### 🚨 Testing Gap Warning

VibeCheck has **no automated tests** in the `tests/` directory. The 9-stage pipeline, FalkorDB graph operations, Semgrep runner, and LLM verification logic all lack test coverage. Before refactoring:
1. Add unit tests for each pipeline stage (mock external dependencies: FalkorDB, Qdrant, Semgrep CLI, Ollama)
2. Add integration tests for Redis Streams consumer/producer
3. Add a `battle_drill`-style smoke test that exercises the full pipeline
4. Without tests, every stage port risks regressions in message shape, error handling, and stream acknowledgment

### Migration Order

1. **Phase 1**: Set up Hono + Zod API structure
2. **Phase 2**: Port Redis Streams + messaging (`ioredis`) — **coordinate `defense_analytics` schema with SWARM first**
3. **Phase 3**: Port Supabase client
4. **Phase 4**: Port Qdrant vector operations
5. **Phase 5**: Replace FalkorDB → Neo4j — prototype openCypher queries first
6. **Phase 6**: Port Tree-Sitter parsing — validate JS bindings thoroughly
7. **Phase 7**: Wrap Semgrep CLI — prototype and benchmark subprocess overhead
8. **Phase 8**: Port Ollama integration
9. **Phase 9**: Build agent system
10. **Phase 10**: Replace Angular.js dashboard with React — **Note: this is deprioritized from the gap recommendation to focus resources on the core pipeline refactor first**
