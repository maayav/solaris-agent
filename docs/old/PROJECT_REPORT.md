# Solaris Agent (VibeCheck) - Comprehensive Technical Report

## Project Overview

**Solaris Agent** (also known as **VibeCheck**) is a sophisticated **dual-agent autonomous security system** that combines Blue Team (defensive security analysis) and Red Team (offensive penetration testing) capabilities. The system uses modern AI/ML techniques including Large Language Models (LLMs), Knowledge Graphs, and Vector Databases to provide comprehensive security auditing of codebases.

**Key Technologies:**
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Framer Motion
- **Backend**: Python 3.12+, FastAPI, Redis Streams
- **Databases**: FalkorDB (Graph), Qdrant (Vector), Redis (Message Bus), Supabase (Cloud Postgres)
- **AI/ML**: Ollama (Local LLM), OpenRouter (Cloud LLM), Gemini
- **Security Tools**: Semgrep, Tree-sitter, nmap, nuclei, sqlmap

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + Vite)                         │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐ │
│  │ Landing  │  │ Dashboard  │  │Pipeline  │  │ TeamChat  │  │  Swarm   │ │
│  └──────────┘  └────────────┘  └──────────┘  └───────────┘  └──────────┘ │
│       │              │              │              │              │          │
│       └──────────────┴──────────────┴──────────────┴──────────────┘          │
│                                    │                                         │
│                           ┌────────▼────────┐                               │
│                           │   lib/api.ts    │                               │
│                           │ (API Client)    │                               │
│                           └────────┬────────┘                               │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            ┌───────────────┐ ┌─────────────┐ ┌─────────────┐
            │   /scan/*     │ │   /chat/*   │ │  /swarm/*   │
            └───────┬───────┘ └──────┬──────┘ └──────┬──────┘
                    │                │               │
┌───────────────────┼────────────────┼───────────────┼─────────────────────────┐
│                   ▼                │               ▼                          │
│         ┌─────────────────────────────────────────────────────────┐          │
│         │              FastAPI Backend (vibecheck)                 │          │
│         │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │          │
│         │  │  scan   │  │  chat   │  │  swarm  │  │ report  │   │          │
│         │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │          │
│         └───────┼────────────┼─────────────┼───────────┼─────────┘          │
│                 │            │             │           │                      │
│       ┌─────────┼────────────┼─────────────┼───────────┼──────────────┐    │
│       │         ▼            │             ▼           │               │    │
│       │  ┌────────────┐     │   ┌─────────────────────┐│               │    │
│       │  │Redis Streams│◄────┼──►│     Supabase        ││               │    │
│       │  │ (scan_queue)│     │   │  (Postgres+Realtime)│               │    │
│       │  └────────────┘     │   └─────────────────────┘               │    │
│       │         │            │                 │                       │    │
│       │         ▼            │                 ▼                       │    │
│       │  ┌────────────┐     │          ┌──────────┐                 │    │
│       │  │Scan Worker │     │          │   Chat   │                 │    │
│       │  │(Background)│     │          │  Handler │                 │    │
│       │  └─────┬──────┘     │          └──────────┘                 │    │
│       │        │             │                                     │    │
│       │        ▼             ▼                                     │    │
│       │  ┌────────────────────────────────────┐                    │    │
│       │  │         Database Layer              │                    │    │
│       │  │  ┌──────────┐  ┌────────┐         │                    │    │
│       │  │  │ FalkorDB │  │ Qdrant │         │                    │    │
│       │  │  │ (Graph)  │  │(Vector)│         │                    │    │
│       │  │  └──────────┘  └────────┘         │                    │    │
│       │  └────────────────────────────────────┘                    │    │
│       │                    │                                       │    │
│       │                    ▼                                       │    │
│       │  ┌────────────────────────────────────────────┐            │    │
│       │  │           Swarm Agents (Red Team)           │            │    │
│       │  │   Commander │ Alpha │ Gamma │ Critic        │            │    │
│       │  └────────────────────────────────────────────┘            │    │
│       └─────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
solaris-agent/
├── frontend/                          # React 19 + Vite Frontend
│   ├── src/
│   │   ├── main.tsx                   # Entry point with BrowserRouter
│   │   ├── App.tsx                    # Root component with routing
│   │   ├── Landing.tsx                # Landing page
│   │   ├── Dashboard.tsx              # Main dashboard (security scanner)
│   │   ├── components/
│   │   │   ├── ui/                    # Reusable UI components (22 components)
│   │   │   ├── providers/             # Context providers
│   │   │   ├── ScanProgress.tsx       # Scan progress visualization
│   │   │   └── TeamChatMessage.tsx    # Chat message component
│   │   ├── lib/
│   │   │   ├── api.ts                 # API client (488 lines)
│   │   │   ├── supabase.ts            # Supabase client
│   │   │   ├── agent-config.ts        # Agent configuration
│   │   │   └── utils.ts               # Utilities
│   │   ├── pages/
│   │   │   ├── TeamChat.tsx           # Team chat page
│   │   │   ├── Pipeline.tsx           # Pipeline visualization
│   │   │   └── Swarm.tsx              # Swarm visualization (107KB)
│   │   └── types/                     # TypeScript type definitions
│   ├── package.json
│   └── vite.config.ts
│
├── vibecheck/                         # Python FastAPI Backend
│   ├── api/
│   │   ├── main.py                    # FastAPI entry point (241 lines)
│   │   └── routes/
│   │       ├── scan.py                # Scan endpoints (481 lines)
│   │       ├── report.py              # Report endpoints
│   │       ├── chat.py                # Chat endpoints
│   │       └── swarm.py               # Swarm mission endpoints
│   ├── core/
│   │   ├── config.py                  # Settings management (Pydantic)
│   │   ├── falkordb.py                # FalkorDB graph client
│   │   ├── qdrant.py                  # Qdrant vector client
│   │   ├── redis_bus.py               # Redis Streams client
│   │   ├── ollama.py                  # Ollama LLM client
│   │   ├── parser.py                  # Code parser (Tree-sitter)
│   │   └── supabase_client.py         # Supabase client
│   ├── agents/
│   │   ├── analyst/                   # Blue Team analysis agent
│   │   └── redteam/                   # Red Team agents
│   ├── worker/
│   │   ├── scan_worker.py             # Main scan worker (1213 lines)
│   │   ├── semgrep_runner.py          # Semgrep integration
│   │   ├── llm_verifier.py            # LLM verification
│   │   └── semantic_lifter.py         # Semantic lifting
│   ├── migrations/                    # Supabase SQL migrations
│   ├── docker-compose.yml              # Local infrastructure
│   └── pyproject.toml                 # Python project config
│
├── swarm module/                      # Red Team Multi-Agent System
│   └── Red_team/
│       ├── agents/
│       │   ├── commander.py           # Commander agent (1083 lines)
│       │   ├── alpha_recon.py         # Alpha recon agent
│       │   ├── gamma_exploit.py       # Gamma exploit agent
│       │   ├── critic_agent.py        # Critic agent for validation
│       │   ├── report_generator.py    # Report generation
│       │   ├── graph.py               # Graph operations
│       │   ├── state.py               # State management
│       │   ├── schemas.py             # Pydantic schemas
│       │   ├── tools/                 # Exploit tools (curl, ffuf, jwt, nmap, nuclei, sqlmap)
│       │   └── a2a/                   # Agent-to-agent messaging
│       ├── api/                       # Red Team API
│       ├── core/                      # Core utilities
│       ├── sandbox/                   # Docker sandbox manager
│       └── tests/                     # Test suite
│
├── docs/                              # Documentation
│   ├── PRD.md                         # Product Requirements Document
│   ├── MVP.md                         # MVP Build Plan
│   ├── setup_guide.md                 # Setup instructions
│   └── next_phase.md                  # Next phase documentation
│
├── plans/                             # Implementation plans
│   ├── mvp-implementation-plan.md
│   ├── swarm-database-schema.md
│   ├── swarm-frontend-database-mapping.md
│   └── swarm-integration-plan.md
│
└── deployment/                        # Deployment configs
    └── (Vercel, Cloudflare)
```

---

## Blue Team Pipeline (Security Scanning)

The Blue Team pipeline performs static analysis on code repositories to identify vulnerabilities. It uses a multi-stage processing workflow.

### Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BLUE TEAM SCANNING PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Stage 1: Clone Repository (0-5%)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • GitPython clones repository with depth=1 (shallow clone)         │   │
│  │  • Unique clone directory per scan_id                                │   │
│  │  • Clones to: {repo_clone_dir}/{scan_id}/                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  Stage 2: Parse Code (5-15%)                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Tree-sitter parser for JS/TS/Python                               │   │
│  │  • Extracts: functions, classes, imports, calls                       │   │
│  │  • Returns ~20+ node types per file                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  Stage 3: Build Knowledge Graph (15-25%)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • FalkorDB (Redis-based graph database)                             │   │
│  │  • Nodes: files, functions, classes, imports                          │   │
│  │  • Edges: calls, imports, inherits, contains                          │   │
│  │  • Enables N+1 detection via Cypher queries                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  Stage 4: Run Detectors (25-35%)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • N+1 query detection (FalkorDB Cypher)                            │   │
│  │  • Pattern matching for common vulnerabilities                      │   │
│  │  • Returns list of candidates with code snippets                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  Stage 5a: Semgrep Analysis (35-50%)                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Static analysis with 25+ security rules                          │   │
│  │  • Deduplication: line-based + adjacent-line                       │   │
│  │  • Filters: test fixtures, non-dict configs                         │   │
│  │  • Extracts: vuln_type, file_path, line numbers, code_snippet        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  Stage 5b: Semantic Lifting (50-65%) [DISABLED]                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Was: LLM generates natural language summaries                     │   │
│  │  • Currently: SKIPPED - using raw Semgrep findings                    │   │
│  │  • Raw findings passed directly to LLM verifier with code snippets   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  Stage 5c: LLM Verification (65-90%)                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Three-tier LLM: Kilo → OpenRouter → Ollama                       │   │
│  │  • Batch processing: 5 candidates in parallel                         │   │
│  │  • Grammar-constrained JSON output                                   │   │
│  │  • Verification: CONFIRMED / REJECTED with confidence                │   │
│  │  • Real-time DB saves for confirmed vulnerabilities                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  Stage 5d: Pattern Propagation (within 5c)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Qdrant vector search for similar functions                        │   │
│  │  • Embeddings via Ollama (nomic-embed-text)                         │   │
│  │  • Propagates confirmed vulnerabilities to similar code               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  Stage 6: Save Results (90-100%)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Batch insert remaining candidates to Supabase                     │   │
│  │  • Update scan status to "completed"                                 │   │
│  │  • Generate markdown report                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Stage Explanations

#### Stage 1: Clone Repository
```
Input:  repo_url (e.g., "https://github.com/user/repo")
Output: Path to cloned repository directory

Implementation (scan_worker.py:781-815):
• Uses GitPython Repo.clone_from()
• Shallow clone (depth=1) for efficiency
• Unique directory per scan_id prevents conflicts
• Runs in thread pool to avoid blocking event loop
```

#### Stage 2: Parse Code
```
Input:  Path to cloned repository
Output: List of parsed nodes (functions, classes, imports, etc.)

Implementation (core/parser.py):
• Tree-sitter for language parsing
• Supported languages: JavaScript, TypeScript, Python
• Extracts node types: function, class, import, call, parameter, decorator
• Returns metadata: file_path, line_start, line_end, name, code_snippet
```

#### Stage 3: Build Knowledge Graph
```
Input:  Parsed nodes from Stage 2
Output: FalkorDB graph with nodes and edges

Implementation (core/falkordb.py):
• Nodes: FILE, FUNCTION, CLASS, IMPORT, CALL
• Edges: DEFINES, IMPORTS, CALLS, CONTAINS, INHERITS
• Enables graph queries like N+1 detection
• Batch inserts for performance
```

#### Stage 4: Run Detectors
```
Input:  FalkorDB graph
Output: List of vulnerability candidates

Implementation (core/falkordb.py - detect_n_plus_1):
• Cypher query identifies N+1 patterns
• Pattern: loop → database call without batch
• Returns: code_snippet, file, line numbers, function_name
```

#### Stage 5a: Semgrep Analysis
```
Input:  Path to cloned repository
Output: List of Semgrep findings (deduplicated)

Implementation (worker/semgrep_runner.py):
• Runs: semgrep --config=rules/ --json {repo_path}
• 25+ security rules covering:
  - sql-injection, xss, ssrf, hardcoded-secrets
  - jwt-issues, path-traversal, command-injection
• Deduplication strategy:
  1. Line-based: same file:line removes duplicates
  2. Adjacent-line: consecutive findings in same file merged
• Filters:
  - Test fixtures (*.test.js, *_test.py)
  - Non-dict configs (semgrep ignores yaml/json)
```

#### Stage 5c: LLM Verification
```
Input:  All candidates (N+1 + Semgrep findings)
Output: Verified vulnerabilities with confidence scores

Implementation (worker/llm_verifier.py - verify_candidate):
• Three-tier fallback:
  1. Primary: Kilo (cloud)
  2. Secondary: OpenRouter (deepseek/deepseek-r1-distill-qwen-32b)
  3. Fallback: Ollama (local, deepseek-coder-v2:16b)
• Batch processing: 5 candidates in parallel (asyncio.gather)
• Grammar-constrained JSON (Ollama format parameter)
• Verification schema:
  {
    "confirmed": boolean,
    "confidence": "high" | "medium" | "low",
    "vuln_type": string,
    "severity": "critical" | "high" | "medium" | "low",
    "verification_reason": string,
    "is_test_fixture": boolean
  }
• Real-time saves: Confirmed vulns saved to DB immediately
• Progress tracking: Updates Supabase every candidate
```

#### Stage 5d: Pattern Propagation
```
Input:  Confirmed vulnerability
Output: List of similar functions in codebase

Implementation (worker/llm_verifier.py - propagate_pattern):
• Embeds confirmed vuln code snippet (Ollama nomic-embed-text)
• Searches Qdrant for similar vectors
• Threshold: 0.85 similarity score
• Returns: file_path, line_start, line_end of similar functions
```

---

## Red Team Pipeline (Autonomous Penetration Testing)

The Red Team uses a multi-agent swarm system to conduct autonomous penetration tests.

### Agent Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RED TEAM SWARM ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                            ┌─────────────┐                                  │
│                            │  Commander  │                                  │
│                            │   (Brain)   │                                  │
│                            │ OpenRouter   │                                  │
│                            │  Qwen3-235B  │                                  │
│                            └───────┬───────┘                                  │
│                                    │                                          │
│           ┌───────────────────────┼───────────────────────┐                │
│           │                       │                       │                │
│           ▼                       ▼                       ▼                │
│    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐         │
│    │Agent Alpha  │         │ Agent Gamma │         │Agent Critic │         │
│    │   (Recon)   │         │  (Exploit)  │         │ (Validate)  │         │
│    │             │         │             │         │             │         │
│    │ • nmap      │         │ • curl     │         │ • 200 OK?   │         │
│    │ • nuclei    │◄────────│ • sqlmap   │────────►│ • Sensitive │         │
│    │ • ffuf      │   A2A   │ • python   │   A2A   │   data?     │         │
│    │ • git history│  msgs   │ • jwt CLI │  msgs   │ • WAF block?│         │
│    └─────────────┘         └─────────────┘         └─────────────┘         │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     Agent-to-Agent (A2A) Communication                 │ │
│  │                                                                       │ │
│  │  • Redis Streams message bus                                          │ │
│  │  • Message types: TASK_ASSIGNMENT, INTELLIGENCE_REPORT, EXPLOIT_RESULT│ │
│  │  • Priority levels: LOW, NORMAL, HIGH                                  │ │
│  │  • Blackboard: Shared state for mission memory                         │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Commander Agent Logic

The Commander is the orchestrator that uses OpenRouter Qwen3-235B to:
1. **Plan**: Decompose mission objective into task assignments
2. **Observe**: Evaluate agent reports, decide next phase

**State Management (RedTeamState):**
```python
{
    "mission_id": str,
    "objective": str,              # Mission goal
    "target": str,                 # Target URL
    "iteration": int,              # Current iteration (max 5)
    "max_iterations": int,
    "phase": "recon" | "exploitation" | "complete",
    "strategy": str,
    "messages": list[A2AMessage],
    "blackboard": {
        "successful_vectors": list[str],      # OWASP categories exploited
        "compromised_endpoints": list[str],    # Successfully exploited
        "forbidden_endpoints": list[str],      # Blocked by Blue Team
        "stealth_mode": bool,
    },
    "blue_team_intelligence_brief": str,       # Static analysis findings
}
```

**Kill Chain Phases:**
1. **Recon**: Gathering intelligence (nmap, nuclei, ffuf)
2. **Exploitation**: Active attacks (SQLi, XSS, IDOR, Auth Bypass)
3. **Complete**: Mission finished

**Vector Rotation Policy (PRD v4.0):**
- Must rotate through 3+ distinct OWASP categories
- Never repeat same exploit type on same endpoint
- Document kill chain narrative (Finding A → Asset B → Exploit C)

**WAF Adaptation:**
- On 403/WAF_BLOCK: Retry with encoding (URL, Base64, hex)
- Rotate payloads: plain → URL encoded → double URL encoded

**Stealth Mode:**
- Activated when: defense_analytics > 3 OR high severity alerts
- Techniques: Custom headers, User-Agent rotation, delays

### Mission Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RED TEAM MISSION FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. MISSION START                                                           │
│     └─► frontend/triggerSwarmMission()                                      │
│         └─► POST /swarm/trigger                                             │
│             └─► swarm.router.trigger_mission()                              │
│                 └─► Create mission in Supabase                               │
│                     Initialize RedTeamState                                  │
│                     Spawn agents (Commander, Alpha, Gamma, Critic)             │
│                                                                              │
│  2. PLANNING PHASE                                                          │
│     └─► Commander.commander_plan()                                          │
│         ├─► Read objective, target, blue_team_intel                           │
│         ├─► LLM: Generate task assignments (PLAN_PROMPT)                     │
│         └─► Emit TASK_ASSIGNMENT messages to Alpha/Gamma                     │
│                                                                              │
│  3. EXECUTION PHASE (iterations 1-5)                                        │
│     ┌────────────────────────────────────────────────────────────────────┐  │
│     │  3a. ALPHA RECON (if tasks include agent_alpha)                    │  │
│     │      ├─► alpha_recon.py:run()                                      │  │
│     │      ├─► Tools: nmap, nuclei, ffuf, curl                           │  │
│     │      └─► Emit INTELLIGENCE_REPORT to Commander                      │  │
│     │                                                                     │  │
│     │  3b. GAMMA EXPLOIT (if tasks include agent_gamma)                   │  │
│     │      ├─► gamma_exploit.py:run()                                    │  │
│     │      ├─► Tools: curl, python, sqlmap                                 │  │
│     │      ├─► Receive found_tokens from Blackboard                        │  │
│     │      └─► Emit EXPLOIT_RESULT to Commander                           │  │
│     │                                                                     │  │
│     │  3c. CRITIC VALIDATION                                              │  │
│     │      ├─► critic_agent.py:validate()                                │  │
│     │      ├─► Verify: 200 OK + sensitive data presence                   │  │
│     │      ├─► Check: WAF_BLOCK, detection signatures                     │  │
│     │      └─► Update defense_analytics in Redis                         │  │
│     │                                                                     │  │
│     │  3d. COMMANDER OBSERVE                                              │  │
│     │      ├─► commander_observe()                                        │  │
│     │      ├─► Read all agent reports + blue_team_intel                   │  │
│     │      ├─► Update strategy memory (successful_vectors)                │  │
│     │      ├─► Check forbidden_endpoints (5-iteration ban)                │  │
│     │      ├─► Decide: continue recon → exploitation → complete           │  │
│     │      └─► Emit new TASK_ASSIGNMENT messages                          │  │
│     └────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  4. MISSION COMPLETE                                                        │
│     └─► commander_observe() returns next_phase="complete"                   │
│         └─► report_generator.py:generate_report()                           │
│             └─► POST findings to Supabase                                   │
│                 └─► WebSocket update to frontend                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow & Processing Workflow

### Scan Request to Completion Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SCAN REQUEST → COMPLETION FLOW                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [CLIENT]                                                                   │
│      │                                                                       │
│      │ POST /scan/trigger { repo_url, triggered_by }                        │
│      ▼                                                                       │
│  [API SERVER]                                                                │
│      │                                                                       │
│      ├─► 1. Generate scan_id (UUID)                                          │
│      ├─► 2. Create scan record in Supabase (status=pending)                  │
│      ├─► 3. Publish to Redis Stream: scan_queue                             │
│      │       { scan_id, repo_url, triggered_by, timestamp }                  │
│      └─► 4. Return: { scan_id, message, queue_position }                    │
│                                                                              │
│  [REDIS STREAM]                                                             │
│      │                                                                       │
│      │ Consumer Group: scan_workers                                          │
│      │ Message remains in stream until ACK'd                                 │
│      │ Pending messages auto-claimed after 60s idle                           │
│      ▼                                                                       │
│  [SCAN WORKER]                                                               │
│      │                                                                       │
│      ├─► Clone repository (GitPython)                                         │
│      │       └── Updates Supabase: progress=5%, stage="Clone Repository"     │
│      │                                                                       │
│      ├─► Parse code (Tree-sitter)                                            │
│      │       └── Updates Supabase: progress=15%, stage="Parse Code"         │
│      │                                                                       │
│      ├─► Build FalkorDB graph                                                │
│      │       └── Updates Supabase: progress=25%, stage="Build Knowledge Graph"│
│      │                                                                       │
│      ├─► N+1 detection (Cypher query)                                        │
│      │       └── Updates Supabase: progress=35%, stage="Run Detectors"       │
│      │                                                                       │
│      ├─► Semgrep analysis                                                    │
│      │       └── Updates Supabase: progress=50%, stage="Semgrep Analysis"   │
│      │                                                                       │
│      ├─► LLM Verification (batched, 5 at a time)                           │
│      │       │                                                               │
│      │       ├─► For each CONFIRMED vuln:                                   │
│      │       │       ├── Real-time save to Supabase                          │
│      │       │       └── Pattern propagation to Qdrant                       │
│      │       │                                                               │
│      │       └── Updates Supabase: progress=70-90%                           │
│      │           stage="LLM Verification (X/Y)"                              │
│      │                                                                       │
│      ├─► Batch save remaining candidates                                      │
│      │       └── Updates Supabase: progress=95%, stage="Save Results"        │
│      │                                                                       │
│      └─► ACK message in Redis                                               │
│              └── Update Supabase: status=completed, progress=100%            │
│                                                                              │
│  [CLIENT POLLING]                                                            │
│      │                                                                       │
│      │ GET /scan/{scan_id}/status                                           │
│      │     └── Returns: status, progress, current_stage, stage_output        │
│      │                                                                       │
│      │ GET /scan/{scan_id}/results                                          │
│      │     └── Returns: summary, findings[], vulnerabilities[]               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Agent-to-Agent (A2A) Communication

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AGENT-TO-AGENT MESSAGE FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [COMMANDER]                                                                │
│      │                                                                       │
│      │ TASK_ASSIGNMENT (to Alpha/Gamma)                                     │
│      │ {                                                                     │
│      │   description: "Scan ports 1-1000",                                  │
│      │   target: "http://localhost:3000",                                   │
│      │   tools_allowed: ["nmap", "curl"],                                   │
│      │   priority: "HIGH",                                                  │
│      │   exploit_type: "recon"                                              │
│      │ }                                                                   │
│      ▼                                                                       │
│  [REDIS STREAMS]                                                            │
│      │                                                                       │
│      │ Stream: a2a_messages:{mission_id}                                    │
│      │ Consumer Group: red_team                                             │
│      ▼                                                                       │
│  [AGENT ALPHA/GAMMA]                                                        │
│      │                                                                       │
│      │ Process task                                                         │
│      │ Execute tools (nmap, curl, etc.)                                     │
│      │                                                                       │
│      │ INTELLIGENCE_REPORT (Alpha) / EXPLOIT_RESULT (Gamma)                 │
│      │ {                                                                     │
│      │   success: true,                                                     │
│      │   exploit_type: "sqli",                                              │
│      │   target: "http://localhost:3000/rest/user/login",                   │
│      │   evidence: "Database version: MySQL 8.0",                            │
│      │   session_token_found: false,                                         │
│      │   blocked: false                                                     │
│      │ }                                                                   │
│      ▼                                                                       │
│  [REDIS STREAMS]                                                            │
│      │                                                                       │
│      │ (reverse direction)                                                  │
│      ▼                                                                       │
│  [COMMANDER]                                                                │
│      │                                                                       │
│      │ commander_observe()                                                  │
│      │ ├─► Read all reports from messages[]                                │
│      │ ├─► Update blackboard (successful_vectors, compromised_endpoints)   │
│      │ ├─► Check forbidden_endpoints (from Blue Team defense_analytics)    │
│      │ └─► Decide next phase                                                │
│                                                                              │
│  [BLACKBOARD] (Redis Hash)                                                  │
│      │                                                                       │
│      │ Key: blackboard:{mission_id}                                         │
│      │ Fields:                                                              │
│      │   • successful_vectors: ["sqli", "idor"]                            │
│      │   • compromised_endpoints: ["http://localhost:3000/rest/basket/1"]  │
│      │   • forbidden_endpoints: ["http://localhost:3000/admin"]            │
│      │   • stealth_mode: true                                               │
│      │   • tokens: { "jwt": "eyJ...", "session": "..." }                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Scan Endpoints (`/scan`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/scan/trigger` | Trigger a new security scan |
| GET | `/scan/{scan_id}/status` | Get scan status and progress |
| GET | `/scan/{scan_id}/results` | Get full scan report with vulnerabilities |
| GET | `/scan/` | List all scans with pagination |
| POST | `/scan/{scan_id}/cancel` | Cancel a running scan |
| POST | `/scan/webhook/github` | GitHub webhook for auto-scan |

### Swarm Endpoints (`/swarm`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/swarm/trigger` | Trigger a new red team mission |
| GET | `/swarm/{mission_id}/status` | Get mission status |
| GET | `/swarm/{mission_id}/events` | Get mission events/timeline |
| POST | `/swarm/{mission_id}/cancel` | Cancel a running mission |

### Health Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health with all DB connections |
| GET | `/health/ready` | Readiness probe for orchestration |

---

## Database Schema

### Supabase Tables

**scans**
```sql
id              UUID PRIMARY KEY
repo_url        TEXT NOT NULL
status          TEXT ('pending'|'running'|'completed'|'failed'|'cancelled')
progress        INTEGER (0-100)
current_stage   TEXT
stage_output    JSONB
error_message   TEXT
triggered_by    TEXT
created_at      TIMESTAMPTZ
started_at      TIMESTAMPTZ
completed_at    TIMESTAMPTZ
```

**vulnerabilities**
```sql
id              UUID PRIMARY KEY
scan_id         UUID REFERENCES scans(id)
vuln_type       TEXT
rule_id         TEXT
severity        TEXT ('critical'|'high'|'medium'|'low')
confidence      TEXT ('high'|'medium'|'low')
file_path       TEXT
line_start      INTEGER
line_end        INTEGER
code_snippet    TEXT
confirmed       BOOLEAN
verification_reason TEXT
is_test_fixture BOOLEAN
created_at      TIMESTAMPTZ
```

**missions**
```sql
id              UUID PRIMARY KEY
objective       TEXT
target          TEXT
status          TEXT ('pending'|'running'|'completed'|'failed')
phase           TEXT ('recon'|'exploitation'|'complete')
strategy        TEXT
created_at      TIMESTAMPTZ
completed_at    TIMESTAMPTZ
```

### FalkorDB Graph Schema

**Node Types:**
- `:File {name, path, extension}`
- `:Function {name, line_start, line_end}`
- `:Class {name, line_start, line_end}`
- `:Import {module, name}`

**Edge Types:**
- `:DEFINES` (File → Function/Class)
- `:IMPORTS` (Function/File → Import)
- `:CALLS` (Function → Function)
- `:CONTAINS` (Class → Function)

### Qdrant Collections

**function_summaries**
```json
{
  "id": "uuid",
  "vector": [0.1, 0.2, ...],  // 768-dim embedding
  "payload": {
    "file": "src/auth/login.js",
    "name": "validatePassword",
    "line_start": 24,
    "line_end": 35,
    "summary": "Validates user password against hash",
    "imports": ["bcrypt"],
    "endpoints": ["/api/login"]
  }
}
```

### Redis Streams

**scan_queue**
- Producer: API server
- Consumer: Scan workers
- Message: `{scan_id, repo_url, triggered_by, timestamp}`

**a2a_messages:{mission_id}**
- Producer: Agents (Commander, Alpha, Gamma)
- Consumer: Agents
- Message types: `TASK_ASSIGNMENT`, `INTELLIGENCE_REPORT`, `EXPLOIT_RESULT`

---

## Configuration

### Environment Variables (`vibecheck/core/config.py`)

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | development | Environment mode |
| `API_PORT` | 8000 | API server port |
| `SUPABASE_URL` | - | Supabase project URL |
| `SUPABASE_ANON_KEY` | - | Supabase anon key |
| `OPENROUTER_API_KEY` | - | OpenRouter API key |
| `FALKORDB_URL` | redis://localhost:6379 | FalkorDB connection |
| `QDRANT_URL` | http://localhost:6333 | Qdrant server |
| `REDIS_URL` | redis://localhost:6380 | Redis server |
| `OLLAMA_BASE_URL` | http://localhost:11434 | Ollama server |
| `OLLAMA_CODER_MODEL` | deepseek-coder-v2:16b | Code analysis model |
| `OLLAMA_EMBED_MODEL` | nomic-embed-text | Embedding model |
| `OPENROUTER_PRIMARY_MODEL` | deepseek/deepseek-r1-distill-qwen-32b | Primary LLM |
| `OPENROUTER_FALLBACK_MODEL` | meta-llama/llama-3.3-70b-instruct | Fallback LLM |
| `MAX_CONCURRENT_SCANS` | 3 | Max parallel scans |

### Frontend Environment (`frontend/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend API URL |
| `GEMINI_API_KEY` | Gemini API key |

---

## Key Features

### 1. Blue Team Security Analysis
- **Tree-sitter Parsing**: Language-aware code analysis
- **Knowledge Graph**: FalkorDB for entity relationships
- **Semgrep Integration**: 25+ security rules
- **LLM Verification**: Three-tier fallback (Kilo → OpenRouter → Ollama)
- **Pattern Propagation**: Qdrant vector similarity

### 2. Red Team Penetration Testing
- **Multi-Agent Swarm**: Commander, Alpha (Recon), Gamma (Exploit), Critic
- **A2A Messaging**: Redis Streams for agent communication
- **Blackboard System**: Shared mission state
- **Vector Rotation**: OWASP Top 10 compliance
- **Adaptive Defense Evasion**: WAF bypass techniques
- **Stealth Mode**: Evasion when detected

### 3. Real-Time Updates
- **Supabase Realtime**: WebSocket updates to frontend
- **Progress Tracking**: Per-stage progress percentages
- **Redis Streams**: Reliable message delivery with ACK
- **Consumer Groups**: Work distribution + fault tolerance

### 4. Three-Layer RAG
1. **Structural Graph RAG**: FalkorDB + Cypher (exact relations)
2. **Semantic RAG**: LightRAG + Semantic Clone
3. **Vector Similarity RAG**: Qdrant + nomic-embed-text

---

## Entry Points

### Frontend
```
frontend/src/main.tsx
  └── App.tsx (with React Router)
      ├── /         → Landing.tsx
      ├── /dashboard → Dashboard.tsx
      ├── /team-chat → TeamChat.tsx
      ├── /pipeline → Pipeline.tsx
      └── /swarm    → Swarm.tsx
```

### Backend API
```bash
# Via Poetry
poetry run vibecheck-api

# Via Python module
python -m api.main

# Via uvicorn directly
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

### Scan Worker
```bash
# Via Poetry
poetry run vibecheck-worker

# Via Python module
python -m worker.scan_worker
```

---

## Docker Services

### docker-compose.yml (vibecheck/)

| Service | Port | Purpose |
|---------|------|---------|
| FalkorDB | 6379 | Graph database |
| Qdrant | 6333/6334 | Vector database |
| Redis | 6380 | Message bus |
| Juice Shop | 8080 | OWASP test target |

---

## Severity Mapping

Vulnerability type to severity mapping used by the scanner:

| Vulnerability Type | Severity |
|-------------------|----------|
| sql_injection, sqli | critical |
| hardcoded_jwt | critical |
| command_injection, code_injection | critical |
| xss, cross-site scripting | high |
| ssrf, server-side request forgery | high |
| hardcoded_secret | high |
| prototype_pollution | high |
| path_traversal, lfi | high |
| missing_auth | high |
| jwt_issue | high |
| n_plus_1 | medium |
| open_redirect | medium |
| csrf | medium |
| security_misconfiguration | medium |
| weak_crypto, weak_random | medium |
| cors_misconfiguration | medium |

---

## Report

This report was generated by analyzing the complete codebase at:
`D:\Backup\Projects\Prawin\solaris\solaris-agent`

Key source files analyzed:
- `vibecheck/worker/scan_worker.py` (1213 lines)
- `vibecheck/api/routes/scan.py` (481 lines)
- `vibecheck/core/redis_bus.py` (460 lines)
- `vibecheck/api/main.py` (241 lines)
- `swarm module/Red_team/agents/commander.py` (1083 lines)
