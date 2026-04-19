# PRD v4.2 — Project VibeCheck: Hybrid Local-First DevSecOps Ecosystem

**Version:** 4.2 | **Status:** Active Draft | **Incorporates:** Semantic Lifting, Full RAG Stack, Taint Analysis, Auto-Remediation, and **PentAGI-Inspired Autonomous Red Teaming**.

***

## 1. Executive Summary

Project VibeCheck is a dual-agent autonomous security system that audits and red-teams AI-generated ("vibecoded") code. It uses a **three-layer RAG pipeline** — structural (FalkorDB Knowledge Graph), semantic (Qdrant Vector Store), and architectural (Semantic Clone + LLM) — to expose hidden dependencies, taint flows, and architectural timebombs invisible to linters. 

Inspired by frameworks like PentAGI, VibeCheck's **hierarchical multi-agent swarm** simulates real adversary kill chains nightly using a self-reflective execution loop. The red team agents possess a dynamic tool registry, episodic memory for persistent learning, and human-in-the-loop (HITL) checkpoints for destructive actions. All heavy compute runs locally via Ollama and Docker; cloud services (Supabase, OpenRouter) handle state and high-reasoning tasks at zero marginal cost. The OWASP Juice Shop serves as the canonical red-team target during development.

***

## 2. What Changed: v4.0 → v4.2

| Prior Decision | Problem | v4.2 Fix (PentAGI & Automation Upgrades) |
|---|---|---|
| Read-only reporting | Leaves mitigation strictly to human developers. | **Auto-remediation (Stage 9)** generates `git diffs`, branches the repo locally, and opens a Pull Request with fixes via `qwen2.5-coder:7b`. |
| Linear exploit generation | Gamma agent guesses payloads blindly; fails if the first try doesn't work. | **PentAGI-Style Execution Loop:** Gamma agent uses a `Plan → Select Tool → Execute → Analyze → Correct` loop. It parses CLI errors and rewrites payloads automatically. |
| Hardcoded Red Team Tools | Adding new fuzzers or tools requires altering core Python logic. | **Dynamic Tool Registry:** Tools (Nuclei, curl, python-requests, nmap) are exposed to the LLM via JSON schema. The LLM selects the tool dynamically. |
| Unrestricted Autonomy | AI might accidentally drop a staging database during testing. | **Human-in-the-Loop (HITL) Checkpoint:** LangGraph pauses execution and sends a Slack/Webhook approval request before running high-impact payloads (e.g., DROP TABLE or heavy fuzzing). |

***

## 3. Full Technical Stack

### 3.1 Infrastructure & State Layer

| Component | Technology | Implementation | Rationale |
|---|---|---|---|
| **Relational DB** | Supabase (Postgres) | Free tier. Tables: `projects`, `scans`, `vulnerabilities`, `kill_chain_events`, `assets` | Auth + RLS + Realtime built-in |
| **Vector Store** | Qdrant (Docker) | Collections: `code_chunks`, `function_summaries`, `known_vulnerable_patterns` | 20x faster than pgvector at 10k+ vectors; HNSW indexing, sub-10ms queries |
| **Structural Graph DB** | FalkorDB (Docker) | Per-scan namespaced graphs `scan_{id}`; Cypher queries for structural analysis | Sub-140ms p99; Redis-compatible; 7x less memory than Neo4j |
| **GraphRAG Engine** | LightRAG (default storage) | Separate LightRAG instance using JSON + nano-vector storage; receives semantic clone as input | Dual-level local/global retrieval; incremental updates |
| **Agent Message Bus** | Redis Streams (Docker) | Streams: `scan_queue`, `a2a_messages`, `red_team_events` | Ordered, persistent, consumer-group-aware task queue |
| **Object Storage** | Supabase Storage | PCAP files, HTML reports, raw scan JSONs | Free tier: 2GB |

### 3.2 AI & Intelligence Layer

| Component | Technology | Model / Config | Role |
|---|---|---|---|
| **Local Coder LLM** | Ollama | `qwen2.5-coder:7b-instruct` | AST summarization, patch generation, tool execution loop |
| **Local Embed Model** | Ollama | `nomic-embed-text:v1.5` (768-dim) | Embedding function bodies → Qdrant |
| **Local Reasoner** | Ollama | `qwen2.5-coder:32b-q4_K_M` (≥24GB) or `mistral-nemo:12b` (16GB) | Exploit logic, log parsing, multi-hop reasoning |
| **Cloud Primary** | OpenRouter | `qwen/qwen3-235b-a22b:free` (131K ctx) | Commander agent, root cause analysis, red team strategy |
| **Cloud Full-Repo** | OpenRouter | `google/gemini-2.0-flash-exp:free` (1M ctx) | Entire semantic clone in one call for architectural drift |
| **AST Parser** | Tree-Sitter | JS, TS, Python, Java grammars | Structural extraction: functions, loops, ORM calls, endpoints |
| **SAST + Taint** | Semgrep OSS | `mode: taint` | Pattern matching + built-in declarative taint analysis |

### 3.4 Orchestration & Backend

| Component | Technology | Notes |
|---|---|---|
| **Agent Framework** | LangGraph | Cyclic state machines with PentAGI node structure. Hierarchical supervisor for Red Team. Features explicit `<HumanApproval>` interrupt nodes. |
| **API Server** | FastAPI (async) | `/scan/trigger`, `/report/{id}`, `/redteam/start`, `/ws/events`, GitHub webhook |
| **Worker Process** | Python 3.10 + asyncio | Long-running; subscribes to Redis Streams; spawns LangGraph workflows |
| **Sandboxing** | Docker-in-Docker | Each scan in a fresh container; read-only mount during scan; writable branch for patching |

***

## 4. The Three-Layer RAG Architecture

Question Type          Layer                    Technology
──────────────────     ─────────────────────    ─────────────────────────
"What connects         Structural Graph RAG     FalkorDB + Cypher
to what?"             (relational, exact)

"What does this        Semantic/Arch RAG        LightRAG + Semantic Clone
code mean?"           (intent, design)         + Gemini 1M ctx

"What looks like       Vector Similarity RAG    Qdrant + nomic-embed-text
this pattern?"        (fuzzy, learned)


*(Refer to v4.0 documentation for exact FalkorDB, Qdrant, and Semantic Clone ingestion parameters)*.

***

## 5. Complete Detection & Remediation Pipeline

*(Stages 1 through 7 remain identical to v4.0: Trigger → Audit → Tree-Sitter → FalkorDB Construction → Parallel Detectors → LLM Verification)*.

### Stage 8 — Write Results & Pattern Learning

All confirmed vulnerabilities → Supabase vulnerabilities table

Confirmed snippets → Qdrant code_chunks collection (Regression Detection)


### Stage 9 — Auto-Remediation & PR Generation (New)

Triggered by Stage 8 for high-confidence, automatically fixable vulnerabilities:
→ Git checkout -b fix/vibecheck-{scan_id} in the writable Docker workspace
→ Extract raw {vuln_snippet} + {semantic_intent} + {rule_violation}
→ Send to Ollama qwen2.5-coder:7b-instruct
Prompt: "You are a security engineer. Generate a git-compatible unified diff
to patch this [vuln_type] without altering the semantic intent."
→ Apply patch via subprocess
→ git commit -m "security(vibecheck): auto-remediate {vuln_type} at {file}"
→ git push origin fix/vibecheck-{scan_id}
→ GitHub API: Open Pull Request with LLM-generated explanation


***

## 6. PentAGI-Inspired Red Team Swarm

The Red Team shifts from a linear payload generator to an autonomous, self-correcting PentAGI-style cognitive architecture.

### 6.1 Commander (Qwen3-235B via OpenRouter)
- **Role:** The strategic supervisor. Reads mission from Supabase + Blue Team graph.
- **Episodic Memory:** Checks Qdrant for "past successful exploitation strategies on similar codebases".
- **Action:** Generates an **Attack Tree** and spawns sub-agents via Redis Streams.
- **Never executes tools directly.**

### 6.2 Agent Alpha — Recon (`mistral-nemo:12b`)
- **Tools (JSON Registered):** `nmap`, `git_miner`, `nuclei_passive`.
- **Action:** Maps the attack surface, identifies late-night commits, brittle PRs, and populates the Redis Blackboard (`HSET redteam:blackboard:{mission_id}:*`).

### 6.3 Agent Gamma — Exploit (The PentAGI Actor) (`qwen2.5-coder:7b`)
This agent runs a specific LangGraph loop designed to mimic human pentester persistence.

**The Execution Loop:**
1. **Tool Selection:** Selects from a predefined registry (e.g., `curl`, `custom_python_script`, `nuclei`).
2. **Payload Generation:** Crafts the payload based on Commander's Attack Tree.
3. **Execution Sandbox:** Runs the tool in an isolated Docker container.
4. **Self-Reflection (The PentAGI magic):** Analyzes `stdout`/`stderr`. 
   - *If syntax error:* Edits the script and jumps back to Step 3.
   - *If WAF blocked:* Applies URL/Base64 encoding and jumps back to Step 2.
   - *If success:* Extracts the proof and signals the Commander.
5. **Memory Commit:** If successful, embeds the winning payload into Qdrant's `successful_exploits` collection to give future agents a head-start.

### 6.4 Human-in-the-Loop (HITL) Checkpoints
To prevent the autonomous swarm from causing actual harm during live target tests:
- LangGraph graph contains a `requires_human_approval` edge.
- If an agent intends to run a payload classified as `DESTRUCTIVE` (e.g., SQL `DROP`, mass parameter fuzzing), execution pauses.
- Supabase triggers a webhook to a Slack channel with the exact proposed command.
- An authorized user clicks "Approve" or "Deny" to resume the LangGraph node state.

***

## 7. Revised Docker Compose (Tool Registry Update)

```yaml
version: "3.9"
services:
  # ... (falkordb, qdrant, redis, api remain the same) ...

  # PentAGI Exploit Sandbox
  sandbox:
    image: kalilinux/kali-rolling
    environment:
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./tool_registry:/tools:ro  # Read-only scripts mounted for the LLM
    networks:
      - vibecheck_net

8. Success Metrics
Metric	Target	Measurement
N+1 & Injection Detection	>80% documented cases	Manual check against Juice Shop known issues
Auto-Remediation Rate	>40% of confirmed vulns	Number of successful, test-passing PRs generated
Exploit Self-Correction	>2 iterations per finding	LangGraph node transition logs for Agent Gamma
False Positive Rate	<15%	LLM confirmation rejection rate
API Budget	<10% daily budget consumed	OpenRouter dashboard
9. Future Capability Runway (v4.3+)
9.1 Continuous Reinforcement Learning (RL)

    Goal: Enable the Red Team to learn dynamically without prompt engineering.

    Mechanism: Integrate a lightweight RL algorithm (like PPO) on top of local qwen2.5-coder. Assign a reward function to the Agent Gamma loop (+10 for 200 OK with leaked data, -1 for syntax error, -5 for WAF block).

9.2 Infrastructure-as-Code (IaC) Structural Mapping

    Goal: Extend structural GraphRAG to cloud deployments.

    Mechanism: Add Tree-sitter parsers for Terraform and Dockerfiles. Introduce CloudResource nodes in FalkorDB, linking Endpoint nodes to their host Container to find IAM flaws.

9.3 DAST-to-SAST Feedback Loop

    Goal: Map Red Team runtime exploits directly to static code flaws.

    Mechanism: When the Exploit agent triggers a 500 error, parse the stack trace. Cross-reference the file paths and line numbers with FalkorDB Function nodes to definitively prove exploitability to the developers.