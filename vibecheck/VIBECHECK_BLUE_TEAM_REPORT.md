# VibeCheck Blue Team - Comprehensive Technical Report

**Document Version:** 1.0  
**Last Updated:** 2026-03-26  
**Status:** Complete - Phases 1-3 Implemented  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Data Flow & Pipeline Stages](#3-data-flow--pipeline-stages)
4. [Core Components Deep Dive](#4-core-components-deep-dive)
5. [Detection Capabilities](#5-detection-capabilities)
6. [Database Schema](#6-database-schema)
7. [Frontend Dashboard](#7-frontend-dashboard)
8. [Configuration & Environment](#8-configuration--environment)
9. [Deployment Architecture](#9-deployment-architecture)
10. [API Reference](#10-api-reference)
11. [Known Limitations & Future Work](#11-known-limitations--future-work)

---

## 1. Executive Summary

**VibeCheck Blue Team** is an autonomous security analysis system designed to detect vulnerabilities in AI-generated ("vibecoded") software. It combines multiple detection techniques:

- **Static Code Analysis** using Tree-Sitter parsing
- **Knowledge Graph Analysis** using FalkorDB
- **Pattern-Based Detection** using Semgrep
- **LLM-Assisted Verification** using OpenRouter and Ollama
- **Semantic Similarity Search** using Qdrant vector database

### Key Metrics

| Component | Status | Performance |
|-----------|--------|-------------|
| Tree-Sitter Parser | Production | ~1,000 files/minute |
| FalkorDB Graph Population | Production | ~10,000 nodes/second |
| Semgrep Integration | Production | OWASP, NodeJS, Secrets rules |
| LLM Verification | Production | Two-tier (Cloud + Local fallback) |
| Dashboard | Production | Real-time polling |

---

## 2. System Architecture Overview

### 2.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           VIBECHECK BLUE TEAM                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐         │
│  │   Frontend   │      │     API      │      │   Workers    │         │
│  │   (React)    │──────│  (FastAPI)   │──────│  (Python)    │         │
│  │   Next.js    │      │   Port 8000  │      │  Redis Bus   │         │
│  └──────────────┘      └──────────────┘      └──────────────┘         │
│         │                    │                    │                  │
│         │                    │                    │                  │
│         └────────────────────┴────────────────────┘                     │
│                              │                                         │
│                              ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                        BACKING SERVICES                           │  │
│  │                                                                  │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │  │
│  │  │  Redis   │  │ FalkorDB │  │  Qdrant  │  │ Supabase │         │  │
│  │  │ Streams  │  │  Graph   │  │  Vector  │  │  (Cloud) │         │  │
│  │  │  Port    │  │  Port    │  │  Port    │  │  HTTPS   │         │  │
│  │  │  6380    │  │  6379    │  │  6333    │  │  API     │         │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │  │
│  │                                                                  │  │
│  │  ┌──────────┐  ┌──────────┐                                      │  │
│  │  │  Ollama  │  │ Semgrep  │                                      │  │
│  │  │  Local   │  │  Binary  │                                      │  │
│  │  │  LLM     │  │  Runner  │                                      │  │
│  │  │ Port 11434│  │  (Subprocess)│                                    │  │
│  │  └──────────┘  └──────────┘                                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Service Responsibilities

| Service | Role | Technology |
|---------|------|------------|
| **Frontend** | User interface, real-time updates | Next.js 14, React, Tailwind CSS |
| **API Server** | HTTP endpoints, scan orchestration | FastAPI, Python 3.12 |
| **Scan Worker** | Background job processing | Python asyncio, Redis Streams |
| **Redis** | Message bus, job queue | Redis 7 (Streams) |
| **FalkorDB** | Code knowledge graph | FalkorDB (Redis-compatible) |
| **Qdrant** | Vector storage, similarity search | Qdrant |
| **Supabase** | Persistent data storage | PostgreSQL + Realtime |
| **Ollama** | Local LLM inference | Ollama (qwen2.5-coder) |
| **Semgrep** | Static analysis rules | Semgrep CLI |

---

## 3. Data Flow & Pipeline Stages

### 3.1 Complete Pipeline Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SCAN PIPELINE (10 STAGES)                             │
└──────────────────────────────────────────────────────────────────────────────┘

Stage 0: Job Queue (Redis Streams)
├─ User submits repo URL via API
├─ API generates scan_id, creates Supabase record
└─ Job published to Redis Stream "scan_queue"

Stage 1: Clone Repository (5%)
├─ Worker claims job from Redis
├─ Clones repository using GitPython (shallow clone)
└─ Saves to: /tmp/vibecheck/repos/{scan_id}/

Stage 2: Tree-Sitter Parsing (15%)
├─ Parses all .js, .ts, .py files
├─ Extracts: Functions, Endpoints, Loops, ORM calls, SQL queries, Imports
└─ Output: List of ParsedNode objects

Stage 3: Knowledge Graph Construction (25%)
├─ Creates dedicated graph: "scan_{scan_id}"
├─ Inserts nodes batch: Function, Endpoint, Loop, ORMCall, SQLQuery, Module
├─ Creates edges: CONTAINS, HAS_ROUTE, IMPORTS
└─ Creates indexes for fast querying

Stage 4: N+1 Detection (35%)
├─ Runs Cypher query: Endpoint→Function→Loop→ORMCall
├─ Identifies loops with database calls
└─ Produces vulnerability candidates

Stage 5a: Semgrep Analysis (50%)
├─ Runs Semgrep with rules:
│   • p/owasp-top-ten (OWASP Top 10)
│   • p/nodejs (Node.js specific)
│   • p/secrets (Hardcoded credentials)
│   • rules/express-taint.yaml (Custom taint)
│   • rules/express-idor.yaml (IDOR detection)
├─ Deduplicates findings by (file, line)
└─ Produces additional candidates

Stage 5b: Semantic Lifting [DISABLED] (65%)
├─ Skipped for performance
└─ Raw Semgrep findings passed directly to LLM

Stage 5c: LLM Verification (70-85%)
├─ Tier 1: OpenRouter (Cloud LLM)
│   • Primary: deepseek/deepseek-r1-distill-qwen-32b
│   • Fallback: meta-llama/llama-3.3-70b-instruct
├─ Tier 2: Ollama (Local fallback)
│   • Model: qwen2.5-coder:7b-instruct
├─ Each candidate verified in parallel batches (batch_size=5)
└─ Results: confirmed=true/false, confidence, reason, fix_suggestion

Stage 5d: Pattern Propagation (90%)
├─ For confirmed vulnerabilities:
│   • Embed code snippet using Ollama
│   • Search Qdrant for similar patterns
│   • Return top 20 similar functions
└─ Optional: Extend detection to similar code patterns

Stage 6: Results Persistence (95%)
├─ Confirmed vulnerabilities saved in real-time during verification
├─ Remaining candidates saved after verification complete
├─ Upsert to Supabase vulnerabilities table
└─ Update scan status to completed

Stage 7: Report Generation (100%)
├─ Generate markdown report
├─ Save to: /tmp/vibecheck/repos/reports/scan_{scan_id}.md
└─ Dashboard displays results
```

### 3.2 Progress Tracking

The system reports real-time progress to Supabase:

| Stage | Progress | Description |
|-------|----------|-------------|
| Clone | 5% | Repository cloned successfully |
| Parse | 15% | Tree-Sitter parsing complete |
| Knowledge Graph | 25% | FalkorDB graph populated |
| Detectors | 35% | N+1 detection complete |
| Semgrep | 50% | Static analysis with stats |
| Semantic Lifting | 65% | Skipped (disabled) |
| LLM Verification | 70-85% | Real-time progress per batch |
| Pattern Propagation | 90% | Similarity search complete |
| Save Results | 95% | Database persistence |
| Complete | 100% | Final report generated |

---

## 4. Core Components Deep Dive

### 4.1 Code Parser (core/parser.py)

**Purpose:** Extract code entities using Tree-Sitter AST parsing

**Supported Languages:**
- JavaScript (.js, .jsx)
- TypeScript (.ts, .tsx)
- Python (.py)

**Extracted Entities:**

| Entity | Tree-Sitter Query | Example |
|--------|-------------------|---------|
| **Function** | function_declaration, arrow_function, method_definition | `async function getUser() { ... }` |
| **Endpoint** | call_expression with app.get/post/put/delete | `app.get('/users', handler)` |
| **Loop** | for_statement, while_statement, for_in_statement | `for (const id of ids) { ... }` |
| **ORMCall** | .find(), .findAll(), .findOne(), etc. | `User.findByPk(id)` |
| **SQLQuery** | template_string with SQL keywords | `` `SELECT * FROM users` `` |
| **Module** | import_statement, require() | `import express from 'express'` |

**Key Features:**
- 1MB file size limit (prevents memory issues)
- Excludes: node_modules, .git, __pycache__, dist, build
- Tracks line numbers for precise vulnerability location
- Detects dynamic loops (iterating over user input)

### 4.2 Knowledge Graph (core/falkordb.py)

**Purpose:** Store code entities and relationships in graph database

**Graph Structure:**

```
┌─────────────────────────────────────────────────────────┐
│                    FALKORDB SCHEMA                       │
└─────────────────────────────────────────────────────────┘

Nodes (per scan):
├─ Function: name, file, line_start, line_end, is_async, params
├─ Endpoint: name, file, line_start, line_end, method, path, handler
├─ Loop: file, line_start, line_end, type, is_dynamic, iterator_var
├─ ORMCall: file, line_start, line_end, method, model, has_where
├─ SQLQuery: file, line_start, line_end, query
└─ Module: file, line_start, line_end, name, source, type

Edges:
├─ CONTAINS: Function → Loop
├─ CONTAINS: Loop → ORMCall
├─ CONTAINS: Loop → SQLQuery
├─ HAS_ROUTE: Endpoint → Function
└─ IMPORTS: Module → Module
```

**N+1 Detection Query:**

```cypher
MATCH (e:Endpoint)-[:HAS_ROUTE]->(f:Function)-[:CONTAINS]->(l:Loop)-[:CONTAINS]->(q:ORMCall)
RETURN e.path as endpoint_path,
       e.method as method,
       l.file as file,
       l.line_start as line_start,
       q.method as orm_method,
       q.model as model,
       f.name as function_name
```

### 4.3 Vector Database (core/qdrant.py)

**Purpose:** Semantic similarity search for code patterns

**Collections:**

| Collection | Purpose | Vector Size |
|------------|---------|-------------|
| code_chunks | File-level embeddings | 768-dim |
| function_summaries | Function-level embeddings | 768-dim |
| known_vulnerable_patterns | Pre-seeded vulnerability patterns | 768-dim |

**Pre-seeded Patterns (6 patterns):**
1. n-plus-1-orm-in-loop
2. sqli-string-concat
3. hardcoded-jwt-secret
4. prototype-pollution
5. path-traversal
6. unguarded-admin-route

**Distance Metric:** COSINE

### 4.4 Message Bus (core/redis_bus.py)

**Purpose:** Async job queue and inter-service communication

**Streams:**

| Stream | Purpose | Consumer Group |
|--------|---------|----------------|
| scan_queue | Scan job queue | scan_workers |
| a2a_messages:{mission_id} | Agent-to-agent messaging | red_team |
| red_team_events | Red team event streaming | red_team |

**Features:**
- Consumer groups for load balancing
- Pending message claiming (handles crashed workers)
- NOGROUP error recovery
- Blackboard pattern for shared state

### 4.5 Scan Worker (worker/scan_worker.py)

**Purpose:** Background process that executes scan pipeline

**Initialization:**
```python
class ScanWorker:
    - Connects to Redis
    - Initializes Qdrant client
    - Seeds known vulnerable patterns
    - Claims pending messages from crashed workers
```

**Main Loop:**
```python
async for message in redis_bus.consume(stream_name, group_name, consumer_name):
    await process_message(message)
```

**Error Handling:**
- Connection errors: Retry with exponential backoff
- Clone errors: Mark scan as failed
- Parse errors: Log and continue
- LLM errors: Use fallback or skip candidate

### 4.6 LLM Verifier (worker/llm_verifier.py)

**Purpose:** Two-tier LLM verification of vulnerability candidates

**Tier 1 - OpenRouter (Cloud):**
- **Primary Model:** deepseek/deepseek-r1-distill-qwen-32b
- **Fallback Model:** meta-llama/llama-3.3-70b-instruct
- **Timeout:** 120 seconds
- **Provider Priority:** Together, DeepInfra, Fireworks, Nebius
- **Skip:** Cloudflare (unreliable)

**Tier 2 - Ollama (Local):**
- **Model:** qwen2.5-coder:7b-instruct
- **Timeout:** 60 seconds
- **Fallback:** Used when OpenRouter fails

**Prompt Engineering:**
- System prompt: "You are a security expert analyzing code..."
- Includes vulnerability type definitions
- Critical patterns highlighted
- Returns JSON: {confirmed, confidence, reason, fix_suggestion, severity}

**Supported Vulnerability Types:**
- sql_injection, nosql_injection, nosql_where_injection
- orm_operator_injection, idor, insecure_cookie
- weak_random_secret, prototype_pollution, path_traversal
- command_injection, eval_injection, ssrf, open_redirect
- hardcoded_secret, mass_assignment, security_misconfiguration

### 4.7 Semgrep Runner (worker/semgrep_runner.py)

**Purpose:** Static analysis using Semgrep rules

**Rule Sets:**

| Rule Set | Description |
|----------|-------------|
| p/owasp-top-ten | OWASP Top 10 vulnerabilities |
| p/nodejs | Node.js specific security issues |
| p/secrets | Hardcoded credentials, API keys |
| rules/express-taint.yaml | Custom taint analysis for Express |
| rules/express-idor.yaml | IDOR detection rules |

**Deduplication Strategy:**
1. Line-based: Same file + line_start = duplicate
2. Adjacent: Within 30 lines + same rule = same vulnerability
3. Function-boundary-aware: Won't collapse across function boundaries
4. Custom rules preferred: rules.* over built-in rules

**Test Fixture Filtering:**
Skips files containing:
- test, spec, __tests__, fixture, mock
- codefixes, vulncodefixes
- _correct.ts, impossible.php
- .min., .test., .spec.

### 4.8 Semantic Lifter (worker/semantic_lifter.py)

**Purpose:** Create LLM-optimized code summaries (DISABLED)

**Status:** Currently disabled for performance reasons

**When Enabled (Phase A + B):**
- **Phase A (Free):** Structural facts from Tree-Sitter
  - Imports, Endpoints, Loops, ORM calls, SQL queries
- **Phase B (Ollama):** Per-function summaries
  - Purpose, data read/written, security behaviors, patterns

**Output:** semantic_clone/{filename}.semantic.txt

---

## 5. Detection Capabilities

### 5.1 Detection Matrix

| Vulnerability | Detection Method | Verification | Severity |
|--------------|------------------|--------------|----------|
| **N+1 Query** | FalkorDB Cypher | LLM | medium |
| **SQL Injection** | Semgrep p/owasp-top-ten | LLM | critical |
| **NoSQL Injection** | Custom Semgrep rules | LLM | critical |
| **IDOR** | Custom Semgrep rules | LLM | high |
| **Hardcoded Secrets** | Semgrep p/secrets | LLM | high |
| **Path Traversal** | Semgrep + Custom | LLM | high |
| **XSS** | Semgrep p/owasp-top-ten | LLM | high |
| **Prototype Pollution** | Semgrep + Custom | LLM | high |
| **Insecure Cookies** | Custom Semgrep rules | LLM | medium |
| **Weak Random** | Custom Semgrep rules | LLM | medium |
| **Command Injection** | Semgrep p/owasp-top-ten | LLM | critical |
| **SSRF** | Semgrep p/owasp-top-ten | LLM | high |

### 5.2 Critical Pattern Detection

The LLM verifier specifically looks for:

```javascript
// IDOR Patterns
findOne({where: {UserId: req.body.UserId}})  // No ownership verification
findOne({where: {id: req.params.id}})       // Basket/Order IDOR

// NoSQL $where Injection
{$where: 'this.product == ' + req.body.id}  // String concatenation

// JSON.parse in where clause
where: JSON.parse(req.params.id)            // Operator injection

// Insecure Cookies
res.cookie('token', value)                  // No httpOnly: true

// Weak Random for Secrets
secret: '' + Math.random()                  // Not cryptographically secure
```

---

## 6. Database Schema

### 6.1 Core Tables

#### scan_queue
```sql
CREATE TABLE scan_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    repo_url TEXT,
    status TEXT CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0,
    error_message TEXT,
    triggered_by TEXT DEFAULT 'manual',
    current_stage TEXT,
    stage_output JSONB,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### vulnerabilities
```sql
CREATE TABLE vulnerabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scan_queue(id),
    type TEXT NOT NULL,                    -- vuln_type
    severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    file_path TEXT NOT NULL,
    line_start INTEGER,
    line_end INTEGER,
    code_snippet TEXT,
    title TEXT,
    description TEXT,
    confirmed BOOLEAN DEFAULT FALSE,
    confidence_score DECIMAL(3, 2),
    fix_suggestion TEXT,
    verification_reason TEXT,
    cwe_id TEXT,
    rule_id TEXT,                          -- detector rule
    detector TEXT,                         -- 'semgrep', 'falkordb'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Unique constraint prevents duplicates
    UNIQUE(scan_id, file_path, line_start)
);
```

### 6.2 Swarm Tables (For Red Team Integration)

#### swarm_missions
```sql
CREATE TABLE swarm_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scan_queue(id),
    target TEXT NOT NULL,
    objective TEXT NOT NULL,
    mode TEXT CHECK (mode IN ('live', 'static')),
    max_iterations INTEGER DEFAULT 3,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    current_phase TEXT,
    iteration INTEGER DEFAULT 0,
    findings JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### swarm_agent_events
```sql
CREATE TABLE swarm_agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id),
    agent_name TEXT NOT NULL,
    agent_team TEXT CHECK (agent_team IN ('red', 'blue', 'purple', 'blue2', 'sand')),
    event_type TEXT CHECK (event_type IN ('log', 'action', 'warning', 'error', 'success', 'info', 'cmd')),
    message TEXT NOT NULL,
    payload JSONB DEFAULT '{}',
    iteration INTEGER,
    phase TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### swarm_findings
```sql
CREATE TABLE swarm_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id),
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    finding_type TEXT,  -- 'SQLi', 'XSS', 'IDOR', 'RCE', etc.
    source TEXT,        -- 'SAST', 'DAST', 'RECON', 'EXPLOIT'
    target TEXT,
    endpoint TEXT,
    file_path TEXT,
    line_start INTEGER,
    confirmed BOOLEAN DEFAULT FALSE,
    agent_name TEXT,
    evidence JSONB DEFAULT '{}',
    cve_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.3 Realtime Subscriptions

All tables enabled for Supabase Realtime:
- `scan_queue` - Live status updates
- `vulnerabilities` - New findings
- `swarm_missions` - Mission progress
- `swarm_agent_events` - Agent logs
- `swarm_findings` - New discoveries
- `swarm_agent_states` - Agent status

---

## 7. Frontend Dashboard

### 7.1 Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| State | React hooks (useState, useEffect) |
| HTTP | Native fetch API |

### 7.2 Component Architecture

```
dashboard/src/
├─ app/
│  ├─ page.tsx              # Main chat interface
│  ├─ layout.tsx            # Root layout
│  └─ globals.css           # Global styles
├─ components/
│  ├─ WelcomeScreen.tsx     # Initial screen with examples
│  ├─ ChatInput.tsx         # URL/message input
│  ├─ ChatMessage.tsx       # Message display with vuln cards
│  ├─ ScanProgress.tsx      # Real-time scan progress
│  └─ Sidebar.tsx           # Conversation history
├─ hooks/
│  └─ useScan.ts            # Scan state management
├─ lib/
│  ├─ api.ts                # API client
│  └─ utils.ts              # Utility functions
└─ types/
   └─ index.ts              # TypeScript interfaces
```

### 7.3 Features

**Welcome Screen:**
- GitHub URL input
- Example repositories (Juice Shop, DVWA)
- Quick start guide

**Scan Progress:**
- Real-time stage updates
- Progress bar with percentage
- Stage output details
- Recently verified findings (last 5)

**Vulnerability Display:**
- Markdown-formatted report
- Severity badges (Critical, High, Medium, Low)
- Code snippets with syntax highlighting
- Collapsible details

**Conversation Management:**
- Multiple conversations
- Persistent scan_id per conversation
- Load existing scan results
- Delete conversations

### 7.4 Polling Strategy

```typescript
// useScan hook polling
const DEFAULT_POLL_INTERVAL = 2000;  // 2 seconds
const MAX_RETRIES = 10;

// Exponential backoff on errors
currentInterval = Math.min(currentInterval * 2, 30000);  // Max 30s
```

---

## 8. Configuration & Environment

### 8.1 Environment Variables (.env)

```bash
# Environment
ENVIRONMENT=development
LOG_LEVEL=INFO
API_PORT=8000

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenRouter (Cloud LLM)
OPENROUTER_API_KEY=sk-or-xxxxx
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_PRIMARY_MODEL=deepseek/deepseek-r1-distill-qwen-32b
OPENROUTER_FALLBACK_MODEL=meta-llama/llama-3.3-70b-instruct
OPENROUTER_HTTP_REFERER=https://vibecheck.local

# Local Services
FALKORDB_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
REDIS_URL=redis://localhost:6380

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CODER_MODEL=qwen2.5-coder:7b-instruct
OLLAMA_EMBED_MODEL=nomic-embed-text

# Scan Settings
MAX_CONCURRENT_SCANS=3
REPO_CLONE_DIR=/tmp/vibecheck/repos
MAX_REPO_SIZE_MB=500
MAX_CONCURRENT_LLM_CALLS=10
LLM_VERIFICATION_BATCH_SIZE=20
MAX_CONCURRENT_FILE_PARSING=8
ENABLE_SEMANTIC_LIFTING=false
```

### 8.2 Settings Validation (core/config.py)

```python
class Settings(BaseSettings):
    environment: str = Field(default="development")
    log_level: str = Field(default="INFO")
    
    # Validators ensure correct values
    @field_validator("environment")
    def validate_environment(cls, v: str) -> str:
        allowed = {"development", "staging", "production"}
        if v.lower() not in allowed:
            raise ValueError(f"environment must be one of: {allowed}")
        return v.lower()
```

---

## 9. Deployment Architecture

### 9.1 Docker Compose Services

```yaml
version: "3.9"

services:
  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - "6379:6379"
    volumes:
      - falkordb_data:/data

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage

  redis:
    image: redis:7-alpine
    ports:
      - "6380:6379"
    volumes:
      - redis_data:/data

  juiceshop:
    image: bkimminich/juice-shop:latest
    ports:
      - "8080:3000"
```

### 9.2 Local Development Setup

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
pip install -e .

# 3. Pull Ollama models
ollama pull qwen2.5-coder:7b-instruct
ollama pull nomic-embed-text

# 4. Run migrations in Supabase SQL Editor
# migrations/001_supabase_schema.sql
# migrations/004_add_swarm_tables.sql

# 5. Start API server
python -m api.main

# 6. Start scan worker (in another terminal)
python -m worker.scan_worker

# 7. Start frontend (in another terminal)
cd dashboard
npm install
npm run dev
```

### 9.3 Production Considerations

**Scaling Workers:**
- Run multiple scan_worker processes
- Redis consumer groups automatically load-balance
- Each worker has unique worker_id

**Resource Requirements:**
- Memory: 4GB+ recommended (LLM inference)
- Disk: 10GB for repositories and reports
- CPU: Multi-core for parallel processing

**Security:**
- Use Supabase service_role key for workers
- Restrict Redis access to internal network
- Enable Supabase RLS policies
- Rotate API keys regularly

---

## 10. API Reference

### 10.1 Scan Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/scan/trigger` | Trigger new scan |
| GET | `/scan/{scan_id}/status` | Get scan status |
| GET | `/scan/` | List scans |
| POST | `/scan/{scan_id}/cancel` | Cancel running scan |

### 10.2 Report Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/report/{scan_id}` | Get full report |
| GET | `/report/{scan_id}/vulnerabilities` | List vulnerabilities |
| GET | `/report/{scan_id}/vulnerabilities/{vuln_id}` | Get vulnerability details |
| GET | `/report/{scan_id}/statistics` | Get scan statistics |
| GET | `/report/{scan_id}/export?format={json/csv/sarif}` | Export report |

### 10.3 Health Endpoint

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Check service health |

**Response:**
```json
{
  "status": "healthy",
  "services": {
    "redis": "connected",
    "falkordb": "connected",
    "qdrant": "connected",
    "ollama": "connected"
  }
}
```

---

## 11. Known Limitations & Future Work

### 11.1 Current Limitations

1. **Language Support:** Only JavaScript, TypeScript, Python
2. **Semantic Lifting:** Disabled for performance (can be enabled via config)
3. **Pattern Propagation:** Requires pre-populated function_summaries collection
4. **LLM Costs:** OpenRouter API calls incur costs
5. **Test Fixtures:** May have false positives in intentionally vulnerable test code

### 11.2 Planned Enhancements

**Phase 4: Red Team Integration**
- Commander agent orchestration
- Agent Alpha (Reconnaissance)
- Agent Gamma (Exploit Generation)
- Redis Blackboard A2A messaging

**Phase 5: Advanced Analytics**
- Historical trend analysis
- Repository comparison
- Security score trending

**Phase 6: Integration**
- GitHub webhooks
- CI/CD pipeline integration
- SARIF export for GitHub Advanced Security

### 11.3 Performance Optimizations

- **Parallel Processing:** Batch LLM verification (current: 5 candidates/batch)
- **Caching:** Redis-based result caching
- **Incremental Scans:** Only scan changed files
- **Vector Optimization:** Binary embeddings instead of float32

---

## Appendix A: File Structure Reference

```
vibecheck/
├── api/
│   ├── __init__.py
│   ├── main.py                 # FastAPI entry point
│   └── routes/
│       ├── __init__.py
│       ├── scan.py             # Scan endpoints
│       └── report.py           # Report endpoints
├── core/
│   ├── __init__.py
│   ├── config.py               # Settings management
│   ├── falkordb.py             # Graph database client
│   ├── ollama.py               # Local LLM client
│   ├── parser.py               # Tree-Sitter parser
│   ├── qdrant.py               # Vector database client
│   ├── redis_bus.py            # Message bus client
│   └── supabase_client.py      # Database client
├── worker/
│   ├── __init__.py
│   ├── llm_verifier.py         # LLM verification
│   ├── scan_worker.py          # Main scan worker
│   ├── semgrep_runner.py       # Semgrep integration
│   └── semantic_lifter.py      # Code summarization
├── rules/
│   ├── express-taint.yaml      # Custom taint rules
│   └── express-idor.yaml       # IDOR detection rules
├── migrations/
│   ├── 001_supabase_schema.sql # Core tables
│   ├── 002_add_current_stage.sql
│   ├── 003_add_stage_output.sql
│   └── 004_add_swarm_tables.sql # Swarm tables
├── dashboard/                  # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── types/
│   ├── package.json
│   └── next.config.js
├── docker-compose.yml
├── pyproject.toml
├── requirements.txt
└── .env.example
```

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **VibeCheck** | Code security analysis system |
| **Blue Team** | Defensive security agent (static analysis) |
| **Red Team** | Offensive security agents (coming in Phase 4) |
| **N+1 Query** | Database anti-pattern causing performance issues |
| **IDOR** | Insecure Direct Object Reference |
| **XSS** | Cross-Site Scripting |
| **SQLi** | SQL Injection |
| **SSRF** | Server-Side Request Forgery |
| **Semantic Lifting** | Converting code to LLM-optimized summaries |
| **Pattern Propagation** | Finding similar vulnerable code patterns |
| **Tree-Sitter** | Parser generator for code analysis |
| **FalkorDB** | Redis-compatible graph database |
| **Qdrant** | Vector similarity search engine |
| **Semgrep** | Static analysis tool |
| **Ollama** | Local LLM inference server |
| **OpenRouter** | Cloud LLM API aggregator |

---

*End of Report*
