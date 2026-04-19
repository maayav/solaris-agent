This Product Requirements Document (PRD) outlines the **Dual-Agent DevSecOps Ecosystem ("Project VibeCheck")**, re-architected for a **Local-First, Free-Tier Hybrid Stack**.

This architecture leverages local compute (Ollama) for heavy lifting and free-tier cloud APIs (OpenRouter/Supabase) for intelligence and coordination, minimizing operational costs while maximizing capability.

---

# Product Requirements Document (PRD): Project VibeCheck

**Version:** 2.0 (Hybrid/Local Architecture)
**Status:** Draft
**Focus:** Counter-Vibecoding Defense & Multi-Agent Red Teaming

## 1. Executive Summary

**Project VibeCheck** is an autonomous security ecosystem designed to audit and attack AI-generated ("vibecoded") software. It employs a **Knowledge Graph RAG** approach to understand code complexity and hidden dependencies, ensuring that "vibes" (superficial functionality) do not mask "timebombs" (security flaws/inefficiencies). The system operates on a hybrid model: heavy processing occurs locally via Ollama/Docker, while orchestration and state management happen in the cloud via Supabase.

## 2. User Personas

* **The Architect (Admin):** Deploys the system locally. Cares about finding "N+1 queries" and architectural drift.
* **The Auditor (Analyst Agent):** A "Blue Team" AI that continuously scans PRs for vulnerabilities and performance debt.
* **The Attacker (Red Team Swarm):** A "Red Team" AI squad that attempts to exploit the deployed application using social engineering and payloads.

---

## 3. The "In-Depth" Technical Stack (Hybrid/Free-Tier)

This stack is optimized for **Zero Monthly Cost** (assuming local hardware availability) and **Maximum Privacy**.

### 3.1. Infrastructure & Database (The "State")

| Component | Technology | Specific Implementation | Why this choice? |
| --- | --- | --- | --- |
| **Relational DB** | **Supabase (Postgres)** | Free Tier. Stores Users, Projects, Vuln Reports, and Scan Logs. | Unified Auth + DB + Realtime. |
| **Vector Store** | **Supabase (pgvector)** | Stores code embeddings (chunks of 512 tokens). | Eliminates need for separate Qdrant instance. |
| **Realtime Bus** | **Supabase Realtime** | Subscribes to table `insert` events to trigger local agents. | Replaces Redis for pub/sub command control. |
| **Object Storage** | **Supabase Storage** | Stores raw scan artifacts (HTML reports, PCAP files). | Free tier generous limits. |

### 3.2. The "Brain" (AI & Graph)

| Component | Technology | Specific Implementation | Why this choice? |
| --- | --- | --- | --- |
| **Local LLM** | **Ollama** | Model: `qwen2.5-coder:7b` (Coding), `mistral-nemo` (General). | Free, fast, private. Runs 100% locally. |
| **Cloud LLM** | **OpenRouter** | Model: `google/gemini-2.0-flash-exp:free` (1M Context), `meta-llama/llama-3.3-70b` (Reasoning). | Access to SOTA reasoning for free. |
| **Knowledge Graph** | **FalkorDB** | Docker Container (`falkordb/falkordb`). | Ultra-fast, Redis-compatible graph DB. Simpler than Neo4j. |
| **Graph RAG** | **Microsoft GraphRAG** | Custom Python script using `networkx` + FalkorDB. | Connecting code entities (Function -> API -> DB). |

### 3.3. The "Nervous System" (Backend & Orchestration)

| Component | Technology | Specific Implementation | Why this choice? |
| --- | --- | --- | --- |
| **Agent Logic** | **LangGraph** | Python. Defines the cyclic state machine (Plan -> Act -> Reflect). | Best for multi-agent loops. |
| **API/Worker** | **FastAPI** | Python 3.11+. Runs locally or on a cheap VPS. | Async support for concurrent agent steps. |
| **Complexity Analysis** | **Tree-Sitter** | Python bindings. | **Critical:** Parses AST to mathematically prove  complexity. |

### 3.4. The Frontend (The "Face")

| Component | Technology | Specific Implementation | Why this choice? |
| --- | --- | --- | --- |
| **Framework** | **Next.js 14** | App Router, Server Actions. | React ecosystem standard. |
| **UI Library** | **shadcn/ui** | Tailwind CSS components. | Professional look, copy-paste customization. |
| **Visualization** | **React Flow** | Attack Path Visualization (The "Kill Chain"). | Interactive node-based graphs. |
| **Graph Vis** | **Cosmograph** | Knowledge Graph rendering. | WebGL-powered, handles thousands of nodes smoothly. |

---

## 4. Functional Requirements & Workflows

### 4.1. Feature: The "Knowledge Graph" Audit (Blue Team)

**Goal:** Detect "Vibecoding" artifacts (hidden dependencies, N+1 queries) that standard linters miss.

1. **Ingestion:**
* **User** connects a GitHub Repo.
* **Local Agent** (Ollama) clones the repo.
* **Parser (Tree-Sitter)** extracts: `Classes`, `Functions`, `API Endpoints`, `SQL Queries`.
* **Graph Builder** inserts nodes into **FalkorDB** with edges: `CALLS`, `IMPORTS`, `QUERIES_TABLE`.
* **Vector Embedder** (Ollama `nomic-embed-text`) embeds function bodies and saves to **Supabase**.


2. **Analysis (The "Vibe Check"):**
* **Query:** "Find all API endpoints that query the `Users` table inside a loop."
* **Graph RAG:** The system runs a Cypher query on FalkorDB:
```cypher
MATCH (e:Endpoint)-[:CALLS*]->(l:Loop)-[:CONTAINS]->(q:Query)-[:TARGETS]->(t:Table {name: 'Users'}) RETURN e, l, q

```


* **Reasoning:** If a path is found, the **Cloud LLM (Gemini)** verifies if it is a true N+1 issue.
* **Result:** A "Performance Timebomb" alert is created in Supabase.



### 4.2. Feature: The Multi-Agent Red Team (Red Team)

**Goal:** Exploit the system using a "Swarm" of specialized agents.

1. **Orchestration (LangGraph):**
* **Commander Agent (Cloud LLM):** Reads `Mission: "Extract Admin Password"` from Supabase.
* **Sub-Agents (Local):**
* **Recon Agent:** Runs `nuclei -t technologies` (subprocess). Updates Supabase with "Tech Stack: Django".
* **Social Agent:** Uses Cloud LLM to draft a spear-phishing email targeting "Django Developers" found in git logs.
* **Exploit Agent:** Uses Local LLM to generate a Python payload for a known Django vulnerability (CVE-202X-XXXX) identified by Recon.




2. **Visualization (Realtime):**
* As the Red Team progresses, Supabase Realtime pushes updates to the Next.js frontend.
* **React Flow** draws a new node: "Recon Complete" -> "Vuln Found".



---

## 5. Data Flow Architecture

1. **Trigger:** User pushes code to GitHub.
2. **Notification:** GitHub Webhook -> Supabase Function (Edge) -> Updates `scan_queue` table.
3. **Local Wake-up:** Python Worker (running on your PC/Server) listening to `scan_queue` sees the new job.
4. **Execution:**
* Worker pulls code.
* Worker spins up **FalkorDB** container.
* Worker runs **Ollama** for embedding/graph extraction.
* Worker queries **OpenRouter** for high-level reasoning ("Is this logic sound?").


5. **Reporting:** Worker writes identified vulnerabilities back to Supabase `vulnerabilities` table.
6. **Display:** Next.js Dashboard reads from Supabase and renders the Graph.

---

## 6. Implementation Roadmap

### Phase 1: The "Local Brain" (Weeks 1-2)

* **Objective:** Get the Local Python Worker + Ollama + Supabase working.
* **Deliverables:**
* Python script that listens to Supabase Realtime.
* Integration with `ollama` python library.
* Basic "Vibe Check" (Summary) of a repo using `qwen2.5-coder`.



### Phase 2: The Knowledge Graph (Weeks 3-4)

* **Objective:** Implement GraphRAG for deep analysis.
* **Deliverables:**
* Docker Compose file for **FalkorDB**.
* Tree-Sitter parser script to extract nodes/edges.
* Cypher query logic to detect N+1 loops.



### Phase 3: The Red Team & Dashboard (Weeks 5-6)

* **Objective:** Visualize the attack.
* **Deliverables:**
* Next.js Dashboard with **React Flow**.
* Integration of `nuclei` (ProjectDiscovery) into the Python Worker.
* "Commander" LangGraph workflow to coordinate Recon -> Exploit.



---

## 7. Cost Analysis (Monthly)

| Service | Tier | Estimated Cost |
| --- | --- | --- |
| **Supabase** | Free | $0 (Up to 500MB DB, 2GB Storage) |
| **OpenRouter** | Free | $0 (Using Free Models like Gemini/Llama) |
| **Ollama** | Local | $0 (Uses your hardware/electricity) |
| **FalkorDB** | Docker | $0 (Self-hosted) |
| **Vercel** | Hobby | $0 (Frontend hosting) |
| **Total** | **Hybrid** | **$0.00 / month** |

*Note: If you move the Local Worker to a cloud VPS (e.g., Hetzner/Lambda Labs) for 24/7 uptime, add ~$20-$40/mo for GPU compute.*

---

## 8. Success Metrics

1. **"Vibe" Detection Rate:** Can the system find an N+1 query that *looks* correct but performs poorly? (Target: >80% accuracy).
2. **Graph Build Time:** Time to clone, parse, and graph a 10k LoC repo. (Target: < 2 minutes locally).
3. **Agent Autonomy:** Percentage of Red Team attacks that complete a "Kill Chain" (Recon -> Exploit) without human intervention. (Target: >30%).


For vibecoded sample app:
OWASP Juice Shop (Node.js)

Repo: https://github.com/juice-shop/juice-shop

Why: The gold standard. It contains every OWASP Top 10 vulnerability.

Use Case: Point your Red Team at this to see if the "Recon -> Exploit" loop works.