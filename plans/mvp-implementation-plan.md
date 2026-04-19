# Project VibeCheck - MVP Implementation Plan

**Status:** Ready for Implementation  
**Based on:** MVP.md, PRD.md v3.0  
**Target:** 6-week MVP with Juice Shop as canonical target

---

## Overview

Project VibeCheck is a dual-agent autonomous security system that:
1. **Blue Team:** Uses Knowledge Graph + GraphRAG to detect vulnerabilities (N+1 queries, secrets, architectural drift)
2. **Red Team:** Multi-agent swarm that performs recon → exploit kill chains
3. **Dashboard:** Real-time visualization of vulnerabilities and kill chains

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        LOCAL INFRASTRUCTURE                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ FalkorDB │  │  Qdrant  │  │  Redis   │  │      Ollama      │ │
│  │ (Graph)  │  │ (Vector) │  │ (Queue)  │  │  qwen2.5-coder   │ │
│  │  :6379   │  │  :6333   │  │  :6380   │  │    :11434        │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PYTHON WORKER (FastAPI)                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   API/      │  │   Agents/   │  │        Core/            │  │
│  │  - main.py  │  │  - analyst/ │  │  - falkordb.py         │  │
│  │  - routes/  │  │  - redteam/ │  │  - qdrant.py           │  │
│  │             │  │             │  │  - redis_bus.py        │  │
│  │             │  │             │  │  - ollama.py           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLOUD SERVICES (Free Tier)                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────────────────────────┐ │
│  │    Supabase      │  │           OpenRouter                 │ │
│  │  - Postgres DB   │  │  - gemini-2.0-flash-exp:free        │ │
│  │  - Realtime      │  │  - llama-3.3-70b-instruct:free      │ │
│  │  - Storage       │  │                                      │ │
│  └──────────────────┘  └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NEXT.JS DASHBOARD                           │
├─────────────────────────────────────────────────────────────────┤
│  - React Flow Kill Chain Visualization                           │
│  - Vulnerability Report Table                                   │
│  - Real-time Supabase subscriptions                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Week 1: Foundation (Local Brain)

### Prerequisites

Before starting, ensure you have:
- [ ] Docker Desktop installed and running
- [ ] Python 3.12+ installed
- [ ] Node.js 20+ installed (for dashboard later)
- [ ] Ollama installed (`curl -fsSL https://ollama.com/install.sh | sh` on Mac/Linux)
- [ ] Supabase account created (free tier)

### Step 1.1: Create Project Structure

```
vibecheck/
├── docker-compose.yml
├── .env.example
├── .env
├── pyproject.toml
├── requirements.txt
├── api/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app entry point
│   └── routes/
│       ├── __init__.py
│       ├── scan.py                # POST /scan/trigger
│       └── report.py              # GET /report/{id}
├── agents/
│   ├── __init__.py
│   ├── analyst/
│   │   ├── __init__.py
│   │   ├── graph.py               # LangGraph state machine
│   │   ├── tools.py               # semgrep, tree-sitter, ollama calls
│   │   └── prompts.py
│   └── redteam/
│       ├── __init__.py
│       ├── commander.py           # LangGraph supervisor
│       ├── alpha.py               # Recon agent
│       └── gamma.py               # Exploit agent
├── core/
│   ├── __init__.py
│   ├── falkordb.py                # Graph DB client
│   ├── qdrant.py                  # Vector store client
│   ├── redis_bus.py               # Redis Streams A2A
│   ├── ollama.py                  # Ollama wrapper
│   └── config.py                  # Settings via pydantic-settings
├── worker/
│   ├── __init__.py
│   └── scan_worker.py             # Long-running scan processor
├── dashboard/                     # Next.js app (Week 5)
└── migrations/
    └── 001_supabase_schema.sql    # Supabase tables
```

### Step 1.2: Docker Compose Configuration

Create `docker-compose.yml` with:
- FalkorDB on port 6379
- Qdrant on ports 6333/6334
- Redis on port 6380 (to avoid conflict with FalkorDB)

### Step 1.3: Environment Variables

Required environment variables:
```
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenRouter (for cloud LLM fallback)
OPENROUTER_API_KEY=sk-or-xxxxx

# Local Services
OLLAMA_BASE_URL=http://localhost:11434
FALKORDB_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
REDIS_URL=redis://localhost:6380

# Optional: Local LLM model names
OLLAMA_CODER_MODEL=qwen2.5-coder:7b-instruct
OLLAMA_EMBED_MODEL=nomic-embed-text
```

### Step 1.4: Supabase Schema

Tables to create:
1. `projects` - Repository metadata
2. `scan_queue` - Scan job queue
3. `vulnerabilities` - Detected vulnerabilities
4. `kill_chain_events` - Red team progress events

Enable Realtime on `vulnerabilities` and `kill_chain_events`.

### Step 1.5: Core Module Implementations

#### falkordb.py
- Redis-compatible connection
- Graph creation per scan (namespaced)
- Node/edge insertion helpers
- Cypher query execution

#### qdrant.py
- Client initialization
- Collection creation for code embeddings
- Upsert and search operations

#### redis_bus.py
- Stream producer/consumer
- Consumer group management
- A2A message schema

#### ollama.py
- Chat completion wrapper
- Embedding generation
- Model pulling helpers

### Step 1.6: FastAPI Application

#### main.py
- App initialization
- CORS middleware
- Router inclusion
- Health check endpoint

#### routes/scan.py
- `POST /scan/trigger` - Accept repo URL, create scan job
- `GET /scan/{id}/status` - Check scan progress

#### routes/report.py
- `GET /report/{id}` - Get vulnerability report
- `GET /report/{id}/vulnerabilities` - List vulnerabilities

### Step 1.7: Scan Worker

The worker should:
1. Subscribe to Redis Stream `scan_queue`
2. Clone repository using GitPython
3. Print file tree (Week 1 exit criteria)
4. Later: Parse with Tree-Sitter, build graph, run analysis

### Week 1 Exit Criteria

- [ ] `docker compose up` starts all services
- [ ] `POST /scan/trigger` with a repo URL writes job to Redis Stream
- [ ] Worker reads job, clones repo, prints file tree
- [ ] No analysis yet - just infrastructure working

---

## Week 2: Tree-Sitter Parser + FalkorDB Graph

### Step 2.1: Install Tree-Sitter Dependencies

```bash
pip install tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-python
```

### Step 2.2: Create Parser Module

Create `core/parser.py` to extract:
- `function_declaration` → Function nodes
- `call_expression` → CALLS edges
- `for_statement`/`while_statement` → Loop nodes
- Template literals with SQL → SQLQuery nodes
- `require()`/`import` → IMPORTS edges
- Route definitions (`app.get`, `router.post`) → Endpoint nodes

### Step 2.3: FalkorDB Population

For each parsed file:
1. Create nodes with properties (name, file, line)
2. Create edges between related nodes
3. Namespace graphs per scan (`scan_{scan_id}`)

### Step 2.4: N+1 Detection Query

The core Cypher query:
```cypher
MATCH (e:Endpoint)-[:CALLS*1..5]->(l:Loop)-[:CONTAINS]->(q:SQLQuery)
WHERE l.is_dynamic = true
RETURN e.path, l.file, l.line, q.raw
```

### Week 2 Exit Criteria

- [ ] Juice Shop repo parsed into FalkorDB graph
- [ ] N+1 Cypher query returns at least 1 result
- [ ] Graph build time < 3 minutes for ~50k LoC

---

## Week 3: LightRAG + LLM Verification

### Step 3.1: Install LightRAG

```bash
pip install lightrag-hku
```

### Step 3.2: Configure LightRAG

- FalkorDB as graph backend
- Qdrant for vector retrieval
- Ollama for LLM and embeddings

### Step 3.3: Analyst Agent State Machine

```
[start]
    ↓
[parse_repo]      ← Tree-Sitter → FalkorDB
    ↓
[run_graph_query] ← Cypher N+1 detection
    ↓
[verify_with_llm] ← Ollama confirms
    ↓              ← OpenRouter fallback if uncertain
[write_report]    ← Supabase vulnerabilities table
```

### Step 3.4: Semgrep Integration

Run Semgrep with:
- `p/nodejs-security-audit` rules
- `p/secrets` rules
- Feed results to LLM for false-positive filtering

### Week 3 Exit Criteria

- [ ] Full pipeline runs on Juice Shop end-to-end
- [ ] Supabase `vulnerabilities` table has ≥3 confirmed entries
- [ ] Each entry has `confirmed=true`

---

## Week 4: Red Team MVP

### Step 4.1: LangGraph Red Team Supervisor

3-node MVP:
```
[commander]   ← Qwen3-235B:free (OpenRouter)
     ↓
[agent_alpha] ← nuclei + nmap (local subprocess)
     ↓
[agent_gamma] ← qwen2.5-coder:7b generates exploit PoC
```

### Step 4.2: Nuclei Integration

- Run nuclei subprocess
- Parse JSON output
- Write findings to Redis Blackboard

### Step 4.3: Redis Blackboard A2A

- `post_to_blackboard()` - Agent publishes findings
- `read_from_blackboard()` - Commander reads updates
- Message schema with sender, recipient, type, payload

### Week 4 Exit Criteria

- [ ] Running against local Juice Shop produces `kill_chain_events`
- [ ] Recon → vuln_found without human input

---

## Week 5: Next.js Dashboard

### Step 5.1: Scaffold Next.js App

```bash
npx create-next-app@latest dashboard --typescript --tailwind --app
npx shadcn@latest init
npx shadcn@latest add card badge table tabs
npm install reactflow @supabase/supabase-js
```

### Step 5.2: Kill Chain View (React Flow)

- Node types: Asset, Event
- Edge colors: red=success, yellow=attempted, grey=blocked
- Real-time updates via Supabase Realtime

### Step 5.3: Vulnerability Report View

- shadcn Table component
- Columns: severity, type, file_path, line, description
- Click row → code snippet modal

### Week 5 Exit Criteria

- [ ] Dashboard live at localhost:3001
- [ ] Real-time vulnerability table updates
- [ ] Kill chain graph animates as red team progresses

---

## Week 6: Integration + Demo

### Step 6.1: GitHub Webhook Integration

- `POST /webhook/github` endpoint
- Parse push event, extract repo URL
- Queue scan job

### Step 6.2: Demo Docker Compose

Add Juice Shop as target:
```yaml
juiceshop:
  image: bkimminich/juice-shop
  ports: ["3000:3000"]
```

### Step 6.3: End-to-End Test

1. `docker compose up` - all services start
2. `POST /scan/trigger` with Juice Shop repo
3. Watch dashboard - graph builds, vulns appear
4. `POST /redteam/start` with Juice Shop URL
5. Watch kill chain animate

### Week 6 Exit Criteria

- [ ] Single `docker compose up` + two API calls
- [ ] Populated vulnerability report in browser
- [ ] Kill-chain graph rendered in React Flow

---

## Success Metrics

| Metric | Target |
|--------|--------|
| N+1 detection on Juice Shop | ≥3 confirmed findings |
| Graph build time (50k LoC) | <3 min locally |
| Red team autonomy | Recon → Exploit without human input |
| False positive rate | <20% |
| Dashboard real-time lag | <2s from event to UI |

---

## What's NOT in MVP

- ❌ Agent Beta (Social Engineering)
- ❌ PR auto-patch and GitHub App
- ❌ WAF evasion / payload obfuscation
- ❌ Multi-repo / multi-project support
- ❌ CI/CD GitHub Actions integration

---

## Next Steps

1. **Switch to Code mode** to implement Week 1 foundation
2. Start with `docker-compose.yml` and project structure
3. Implement core modules one by one
4. Test each component before moving to the next

Ready to begin implementation?


