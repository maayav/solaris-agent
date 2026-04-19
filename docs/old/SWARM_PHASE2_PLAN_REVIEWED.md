# SWARM Phase 2 — Remediation & Implementation Master Plan

**Red Team · Multi-Agent · LangGraph · Bug Bounty Platform**

---

## Table of Contents

1. [Part 1: Identified Issues & Remediation](#part-1--identified-issues--remediation)
2. [Part 2: Implementation Roadmap](#part-2--phase-2-implementation-roadmap)
3. [Part 3: Database & Infrastructure](#part-3--database--infrastructure-changes)
4. [Part 4: Testing Strategy](#part-4--testing-strategy)
5. [Part 5: Dependency Graph & Rollout](#part-5--dependency-graph--rollout-sequence)
6. [Part 6: Summary & Key Decisions](#part-6--summary--key-decisions)

---

## Part 1 — Identified Issues & Remediation

### 1.1 Issues Inventory

| Issue | Priority | Effort | Description |
|-------|----------|--------|-------------|
| LLM Model Mismatch | CRITICAL | S | Commander uses coding model for strategic planning; env vs docs inconsistency |
| should_continue() Bluntness | CRITICAL | S | No cost, time, or quality signals |
| Authorization Proof Gap | CRITICAL | M | No enforcement before missions launch |
| Static Mode Underspecified | HIGH | M | Alpha's static mode undocumented |
| Worker Script Debt | HIGH | S | Two worker scripts, no migration path |
| Critic False Positives | HIGH | S | HTTP 500 rule too broad |
| Stealth / Rate Control | MED | M | No coordinated throttling |

---

### Fix 1 — LLM Model Architecture (CRITICAL)

**Root Cause:** Commander falls back to `qwen2.5-coder:7b-instruct` — a code-optimized model unsuitable for strategic reasoning. Docs/runtime divergence between Qwen3-235B and deepseek-r1-0528.

**Fix:** Dedicated Model Tiers

| Agent | Model | Fallback |
|-------|-------|----------|
| Commander (Strategic) | `openrouter:deepseek/deepseek-r1-0528:free` | `openrouter:google/gemini-flash-1.5-exp:free` |
| Alpha Recon (Analytical) | `openrouter:google/gemini-flash-1.5-exp:free` | `ollama:qwen2.5:14b` |
| Gamma Exploit (Code) | `ollama:qwen2.5-coder:14b-instruct` | `ollama:qwen2.5-coder:7b-instruct` |
| Critic (Evaluator) | `ollama:qwen2.5:7b` | — |
| Report Generator | `openrouter:deepseek/deepseek-r1-0528:free` | — |

**Implementation:** Add startup assertion in `core/llm_client.py` validating Commander is NOT using a `-coder` variant.

---

### Fix 2 — should_continue() Intelligence Upgrade (CRITICAL)

**Root Cause:** Routing only checks phase/iteration. No cost awareness, quality signals, or time budget.

**Fix:** Multi-Signal Routing

**New State Fields (`agents/state.py`):**
```python
# Budget Controls
cost_usd: float              # Accumulated LLM API cost
max_cost_usd: float          # Hard budget ceiling (default: $2.00)
started_at: str              # ISO timestamp
max_duration_seconds: int    # Wall-clock limit (default: 3600)

# Quality Signals
critical_findings_count: int # CRITICAL severity findings
high_findings_count: int     # HIGH severity findings
coverage_score: float         # 0.0-1.0 OWASP categories tested
stall_count: int             # Consecutive iterations with 0 new findings
max_stall_count: int         # Stall limit before early exit (default: 2)
```

**New Routing Logic (`agents/graph.py`):**
```python
def should_continue(state: RedTeamState) -> str:
    phase     = state.get('phase')
    iteration = state.get('iteration', 0)
    max_iter  = state.get('max_iterations', 5)
    cost      = state.get('cost_usd', 0.0)
    max_cost  = state.get('max_cost_usd', 2.0)
    stall     = state.get('stall_count', 0)
    max_stall = state.get('max_stall_count', 2)
    started   = state.get('started_at')
    max_dur   = state.get('max_duration_seconds', 3600)
    criticals = state.get('critical_findings_count', 0)

    # Hard stops
    if phase == 'complete':      return 'report'
    if iteration >= max_iter:    return 'report'
    if cost >= max_cost:         return 'report'
    if stall >= max_stall:       return 'report'

    # Time budget check
    if started:
        elapsed = (datetime.utcnow() - datetime.fromisoformat(started)).total_seconds()
        if elapsed >= max_dur:   return 'report'

    # Early success: critical finding + 3+ OWASP categories
    coverage = state.get('coverage_score', 0.0)
    if criticals >= 1 and coverage >= 0.3 and iteration >= 2:
        return 'report'

    # Normal routing
    if phase == 'exploitation':  return 'exploit_only'
    return 'continue'
```

**Commander's OBSERVE_PROMPT:** Increment `stall_count` when no new findings; reset to 0 when new findings appear.

---

### Fix 3 — Authorization Enforcement Gate (CRITICAL)

**Root Cause:** HITL gate only fires mid-mission. No pre-flight authorization check. `needs_human_approval` flag can be bypassed.

**Fix:** AuthorizationContext + Pre-flight Gate

**Schema (`agents/schemas.py`):**
```python
class AuthorizationContext(BaseModel):
    type: Literal['vdp', 'pentest_contract', 'ctf', 'private_lab']
    evidence_url: str | None
    scope_domains: list[str]
    excluded_domains: list[str]
    authorized_by: str
    authorized_at: str
    expiry: str | None
    checksum: str  # SHA256 of above fields
```

**Pre-flight Node (`agents/graph.py`):**
```python
async def preflight_authorization(state: RedTeamState) -> RedTeamState:
    auth = state.get('authorization')
    target = state['target']

    if not auth:
        raise AuthorizationError('No authorization context provided.')

    if not any(domain in target for domain in auth.scope_domains):
        raise AuthorizationError(f'Target {target} not in authorized scope')

    if auth.type == 'vdp' and auth.evidence_url:
        await verify_vdp_scope(auth.evidence_url, target)

    if not verify_checksum(auth):
        raise AuthorizationError('Authorization checksum mismatch')

    state['authorization_verified'] = True
    return state
```

> **NOTE:** `verify_vdp_scope()` and `verify_checksum()` implementations not specified — must be added.

---

### Fix 4 — Static Mode Specification (HIGH)

**Root Cause:** Static mode behavior not documented or separated from live mode.

**Fix:** Explicit Per-Phase Behavior

| Phase | Static Mode Behavior |
|-------|---------------------|
| Alpha Recon | Clone repo, run Semgrep + Bandit + trufflehog, map structure, identify framework |
| Gamma Exploit | Generate PoC scripts — NO network requests, only curl commands + repro scripts |
| Critic | Evaluate by CVSS score + reachability, NOT HTTP status codes |
| Blue Team Bridge | Primary intel source — enriches Alpha with SAST results |
| Report | Include file:line refs, CWE IDs, remediation diffs |

**Tool Dispatch (`agents/alpha_recon.py`):**
```python
STATIC_TOOLS = ['semgrep', 'bandit', 'trufflehog', 'code_search', 'file_tree']
LIVE_TOOLS   = ['nmap', 'nuclei', 'curl', 'ffuf', 'sqlmap', 'jwt_tool']

async def alpha_recon(state: RedTeamState):
    mode = state.get('mode') or detect_target_type(state['target'])
    tools = STATIC_TOOLS if mode == 'static' else LIVE_TOOLS
```

> **NOTE:** `file_tree` tool implementation not specified.

---

### Fix 5 — Worker Script Debt Resolution (HIGH)

**Root Cause:** `swarm_worker.py` and `swarm_worker_new.py` coexist with no documented delta.

**Fix:**
1. Diff both files → document delta in `scripts/MIGRATION_NOTES.md`
2. Merge improvements from `_new` into canonical `swarm_worker.py`
3. Delete `swarm_worker_new.py`
4. Update all references (docker-compose.yml, systemd, README.md)

**Rule:** No `_new`, `_v2`, `_backup` suffixes in production code paths.

---

### Fix 6 — Critic False Positive Reduction (HIGH)

**Root Cause:** `HTTP 500 on injection = success` rule too broad — many apps return 500 for infra issues.

**Fix:** Correlated Success Criteria

```python
def deterministic_evaluate(result: ExploitResult) -> CriticVerdict:
    status = result.http_status
    body   = result.response_body
    vuln   = result.vulnerability_type

    # SQLi: 500 only if body contains DB error signatures
    if vuln == 'sqli' and status == 500:
        db_errors = ['syntax error', 'mysql', 'pg error', 'ORA-', 'sqlite']
        if not any(e.lower() in body.lower() for e in db_errors):
            return CriticVerdict(success=False, reason='500 without DB error')

    # Command injection: 500 only if expected output in body
    if vuln == 'cmdi' and status == 500:
        if not result.expected_output_fragment in body:
            return CriticVerdict(success=False, reason='500 without command output')

    # IDOR: require content divergence
    if vuln == 'idor' and status == 200:
        if result.baseline_response == body:
            return CriticVerdict(success=False, reason='IDOR: identical response')

    # Auth bypass: require privilege indicator
    if vuln == 'auth_bypass' and status in (200, 201):
        priv_tokens = ['admin', 'role":"admin', 'is_admin":true', 'superuser']
        if not any(t in body.lower() for t in priv_tokens):
            return CriticVerdict(success=False, reason='Auth: no privilege escalation')

    return CriticVerdict(success=True)
```

> **NOTE:** Gamma must include `expected_output_fragment` and `baseline_response` in exploit result schema.

---

### Fix 7 — Stealth & Rate Control Strategy (MED)

**Root Cause:** No coordinated throttling across all tools. Parallel tools can aggregate to IDS-triggering rates.

**Fix:** Unified Throttle Controller

```python
class MissionThrottle:
    MODES = {
        'normal':  {'rps': 10, 'jitter_ms': 200},
        'stealth': {'rps': 2,  'jitter_ms': 2000, 'ua_rotate': True},
        'fast':    {'rps': 50, 'jitter_ms': 0},
    }

    def __init__(self, mode='normal'):
        self.config = self.MODES[mode]
        self._semaphore = asyncio.Semaphore(self.config['rps'])

    async def acquire(self):
        async with self._semaphore:
            jitter = random.randint(0, self.config['jitter_ms']) / 1000
            await asyncio.sleep(jitter)
            yield  # tool executes here
```

All sandbox tool executions must acquire from MissionThrottle. Stealth mode auto-engages on WAF blocks.

---

## Part 2 — Phase 2 Implementation Roadmap

### 2.1 Sprint Overview

| Sprint | Focus | Duration |
|--------|-------|----------|
| Sprint 1 | All 7 critical fixes | Weeks 1-2 |
| Sprint 2 | RAG knowledge base, budget state, Auth agent | Weeks 3-6 |
| Sprint 3 | Web crawler, OSINT/CVE intel, stack fingerprinting | Weeks 7-10 |
| Sprint 4 | Coach agent, synthetic labs, vector memory, tool pipeline | Weeks 11-16 |
| Sprint 5 | Dashboard, MCP adapters, reports, plugin SDK | Weeks 17-22 |

### 2.2 Sprint 1 — Critical Fixes (Weeks 1-2)

- [ ] Resolve all 7 issues from Part 1
- [ ] Merge worker scripts, enforce model tiers
- [ ] Deploy AuthorizationContext schema to Supabase
- [ ] Implement unified MissionThrottle
- [ ] Harden Critic correlation checks
- [ ] Zero regressions on existing test suite

### 2.3 Sprint 2 — Core Foundation (Weeks 3-6)

#### Feature 2.1 — Hacking Knowledge RAG

**Knowledge Sources:**

| Source | Content |
|--------|---------|
| OWASP Testing Guide | Test cases, payloads, bypass techniques |
| HackTricks | Tool usage, platform-specific techniques |
| PayloadsAllTheThings | Payload lists (SQLi, XSS, SSRF, XXE) |
| PortSwigger Web Academy | Lab-proven techniques |
| NVD CVE Database | Vulnerability descriptions, version ranges |
| Exploit-DB PoC Archive | Working PoC scripts by CVE |

**Implementation (`core/rag_store.py`):**
```python
class HackingKnowledgeRAG:
    def __init__(self, qdrant_url, collection='hack_docs'):
        self.client = QdrantClient(qdrant_url)
        self.encoder = SentenceTransformer('all-MiniLM-L6-v2')

    async def retrieve(self, query: str, agent_role: str,
                       vuln_class: str = None, limit: int = 5) -> list[HackDoc]:
        filters = Filter(must=[
            FieldCondition(key='agent_roles', match=MatchAny(any=[agent_role, 'all'])),
        ])
        if vuln_class:
            filters.must.append(FieldCondition(key='vuln_class', match=MatchValue(value=vuln_class)))
        hits = self.client.search(
            collection_name='hack_docs',
            query_vector=self.encoder.encode(query).tolist(),
            query_filter=filters,
            limit=limit
        )
        return [HackDoc(**h.payload) for h in hits]

    async def inject_into_prompt(self, base_prompt: str, agent_role: str, context: str) -> str:
        docs = await self.retrieve(context, agent_role, limit=3)
        knowledge = '\n'.join(f'[{d.source}] {d.content}' for d in docs)
        return f'RELEVANT SECURITY KNOWLEDGE:\n{knowledge}\n\n{base_prompt}'
```

> **MISSING:** `chunk_markdown()` function undefined — needs implementation.

#### Feature 2.2 — Auth Agent (Delta)

| Attribute | Value |
|-----------|-------|
| Agent ID | `delta_auth` |
| Primary Model | `ollama:qwen2.5-coder:14b-instruct` |
| Phase | After Alpha recon, before Gamma exploitation |
| Input | Endpoints, login forms, auth headers from blackboard |
| Output | `discovered_credentials` dict |
| Tools | curl, jwt_tool, python_exec, web_search |
| HITL Required | Yes (for credential stuffing) |

**Attack Arsenal:**
```python
AUTH_ATTACK_VECTORS = {
    'jwt_none_alg':     'Change algorithm to none, remove signature',
    'jwt_weak_secret':  'Brute-force HS256 with rockyou subset',
    'jwt_kid_sqli':     'Inject SQL into kid header parameter',
    'oauth_implicit':   'Probe for implicit flow token leakage',
    'saml_xxe':         'Inject XXE payload into SAML assertion',
    'session_fixation':  'Pre-set session ID before authentication',
    'default_creds':     'Test admin/admin, root/root, platform defaults',
    'password_spray':    'Low-rate spray (HITL-gated)',
    'api_key_enum':      'Enumerate API key patterns in JS source',
    'sso_bypass':       'Test SSO assertion manipulation',
}
```

#### Feature 2.3 — Mission-Local Workspace

```python
class MissionWorkspace:
    BASE = Path('/workspace')

    def __init__(self, mission_id: str):
        self.root    = self.BASE / mission_id
        self.scripts = self.root / 'scripts'
        self.lists   = self.root / 'wordlists'
        self.tokens  = self.root / 'tokens'
        self.reports = self.root / 'reports'
        self.logs    = self.root / 'logs'

    async def initialize(self):
        for d in [self.scripts, self.lists, self.tokens, self.reports, self.logs]:
            d.mkdir(parents=True, exist_ok=True)
        await self._seed_wordlists()

    async def cleanup(self, keep_reports=True):
        shutil.rmtree(self.scripts, ignore_errors=True)
        shutil.rmtree(self.lists, ignore_errors=True)

    def path(self, *parts) -> str:
        return str(self.root.joinpath(*parts))
```

Add `workspace_path: str` to RedTeamState.

### 2.4 Sprint 3 — Intelligence & Targeting (Weeks 7-10)

#### Feature 3.1 — Web Crawling Agent

> **Dependency:** Playwright installation in sandbox image

```python
class CrawlerAgent:
    async def crawl(self, target: str, depth: int = 3) -> SiteMap:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            page = await browser.new_page()
            requests = []
            page.on('request', lambda r: requests.append({
                'url': r.url, 'method': r.method, 'headers': dict(r.headers)
            }))
            await page.goto(target)
            await page.wait_for_load_state('networkidle')
            forms = await page.evaluate('''() =>
                [...document.forms].map(f => ({
                    action: f.action, method: f.method,
                    fields: [...f.elements].map(e => ({name: e.name, type: e.type}))
                }))''')
            sitemap = SiteMap(target=target, forms=forms, requests=requests)
            sitemap.classify_owasp()
            return sitemap
```

Graph position: `beta_crawl` between `preflight_authorization` and `commander_plan`.

#### Feature 3.2 — Dynamic API Discovery

```python
async def discover_api_endpoints(target: str, workspace: MissionWorkspace):
    bundles = await fetch_js_bundles(target)
    patterns = []
    for bundle in bundles:
        patterns += re.findall(r'''['"](\/[a-z0-9_\-\/{}:]+)['"]''', bundle)
        patterns += extract_routes_from_ast(bundle)
    endpoints = normalize_endpoints(patterns, base_url=target)
    spec = generate_openapi_stub(endpoints)
    await workspace.write('discovered_api.json', spec.json())
    await blackboard.set('discovered_api', spec.dict())
    return spec
```

#### Feature 3.3 — Intel / CVE Agent

```python
async def intel_agent(state: RedTeamState) -> RedTeamState:
    stack = state['blackboard'].get('stack_fingerprint', {})
    findings = []
    for component, version in stack.items():
        cves = await nvd_search(f'{component} {version}')
        exploits = await exploitdb_search(component, version)
        for cve in cves[:3]:
            poc = await synthesize_poc(cve, component, version)
            findings.append(IntelFinding(
                cve_id=cve.id, component=component,
                cvss=cve.cvss_score, poc=poc,
                exploit_db_url=exploits[0].url if exploits else None
            ))
    await blackboard.set('cve_intel', [f.dict() for f in sorted(findings, key=lambda x: x.cvss, reverse=True)])
    return state
```

### 2.5 Sprint 4 — Self-Improvement Loop (Weeks 11-16)

#### Feature 4.1 — Coach Agent

| Component | Description |
|-----------|-------------|
| Training Targets | Juice Shop, DVWA, WebGoat (docker-compose) |
| Mission Runner | 10 training missions per target with logging |
| Failure Analysis | Coach LLM analyzes missed vulns + root cause |
| Prompt Rewriting | Coach proposes prompt patches as diffs |
| HITL Gate | Human approves patches before commit |
| Regression Testing | Re-run missions to verify improvement |

#### Feature 4.2 — Qdrant Vector Memory

```python
class MissionMemory:
    COLLECTION = 'mission_learnings'

    async def store_learning(self, mission_id: str, stack_fingerprint: dict, successful_exploits: list[dict]):
        for exploit in successful_exploits:
            doc = MissionLearning(
                mission_id=mission_id, stack=stack_fingerprint,
                vuln_class=exploit['type'], payload=exploit['payload'],
                tool=exploit['tool'], endpoint_pattern=exploit['endpoint_pattern'],
                cvss=exploit['cvss'],
            )
            embedding = self.encoder.encode(f"{stack_fingerprint.get('framework')} {exploit['type']} {exploit['endpoint_pattern']}")
            await self.client.upsert(self.COLLECTION, [doc], [embedding])

    async def recall_strategies(self, stack: dict, vuln_class: str) -> list[MissionLearning]:
        query = f"{stack.get('framework')} {stack.get('version')} {vuln_class}"
        return await self.search(self.COLLECTION, query, limit=5)
```

#### Feature 4.3 — Engineer Agent (HIGH RISK)

**Mandatory Pipeline:**
1. `generate_code` — LLM writes tool
2. `static_analysis` — Bandit + safety checks
3. `hitl_review` — Human approval
4. `sandbox_test` — Network-isolated execution
5. `register` — Add to ToolRegistry

> **CRITICAL:** Auto-registration without HITL is explicitly prohibited.

### 2.6 Sprint 5 — Platform & Ecosystem (Weeks 17-22)

#### Feature 5.1 — Dashboard Upgrades

| Component | Description |
|-----------|-------------|
| Mission Timeline | Gantt-style swimlane with agent activity + finding annotations |
| Agent Thought Stream | Real-time LLM reasoning (WebSocket) |
| OWASP Coverage Heatmap | A01-A10 grid with color-coded confidence |
| Kill Chain Progress | Recon → Weaponize → Deliver → Exploit → Post-Exploit |
| Cost Tracker | Live LLM cost vs. budget ceiling |
| Finding Severity Breakdown | Donut chart: CRITICAL/HIGH/MED/LOW/INFO |

**New WebSocket Events:**
```python
AGENT_THOUGHT   = 'agent_thought'     # LLM reasoning step
COST_UPDATE     = 'cost_update'       # {'agent': ..., 'cost_usd': ..., 'total': ...}
COVERAGE_UPDATE = 'coverage_update'   # {'owasp_category': ..., 'tested': True/False}
STALL_WARNING   = 'stall_warning'     # {'stall_count': ..., 'max_stall': ...}
BUDGET_WARNING  = 'budget_warning'    # {'cost_pct': 0.85}
AUTH_FOUND      = 'auth_credential'   # {'type': 'jwt', 'value_hash': ...}
```

#### Feature 5.2 — MCP Tool Adapters

```python
class SwarmMCPBridge:
    async def register_mcp_server(self, server_url: str, server_name: str):
        adapter = MCPToolAdapter(server_url=server_url)
        tools = await adapter.list_tools()
        for mcp_tool in tools:
            wrapped = ToolSpec(
                name=f'mcp_{server_name}_{mcp_tool.name}',
                description=mcp_tool.description,
                args_schema=mcp_tool.input_schema,
                execute=lambda **kw: adapter.call(mcp_tool.name, **kw),
                source='mcp', server=server_name
            )
            self.registry.register(wrapped)
```

#### Feature 5.3 — Report Optimizer

```python
HACKERONE_TEMPLATE = '''
## Summary
{one_sentence_summary}

## Steps to Reproduce
{numbered_repro_steps}

## Supporting Material
```{curl_repro_command}
```

## Impact
{impact_statement}

## Severity
CVSS: {cvss_score} | {cvss_vector}

## Affected Asset
URL: {target_url}
Parameter: {vulnerable_parameter}
'''
```

#### Feature 5.4 — Multi-Target Campaign Mode

```python
class CampaignState(TypedDict):
    campaign_id: str
    targets: list[str]
    missions: dict[str, str]      # target -> mission_id
    shared_intel: dict[str, Any] # Cross-target credential reuse
    active_missions: int
    max_parallel: int             # Default: 3
    completed: list[str]
```

---

## Part 3 — Database & Infrastructure Changes

### 3.1 Supabase Migrations

```sql
-- Migration 001: Authorization contexts
CREATE TABLE swarm_authorizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id      UUID REFERENCES swarm_missions(id),
    type            TEXT NOT NULL,
    evidence_url    TEXT,
    scope_domains   TEXT[],
    excluded_domains TEXT[],
    authorized_by   TEXT NOT NULL,
    authorized_at   TIMESTAMPTZ NOT NULL,
    expiry          TIMESTAMPTZ,
    checksum        TEXT NOT NULL,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Migration 002: Budget tracking
ALTER TABLE swarm_missions ADD COLUMN cost_usd        DECIMAL(10,4) DEFAULT 0;
ALTER TABLE swarm_missions ADD COLUMN max_cost_usd   DECIMAL(10,4) DEFAULT 2.0;
ALTER TABLE swarm_missions ADD COLUMN max_duration_s INTEGER       DEFAULT 3600;
ALTER TABLE swarm_missions ADD COLUMN stall_count     INTEGER       DEFAULT 0;
ALTER TABLE swarm_missions ADD COLUMN coverage_score DECIMAL(4,3)  DEFAULT 0;

-- Migration 003: Agent cost ledger
CREATE TABLE swarm_cost_ledger (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id    UUID REFERENCES swarm_missions(id),
    agent_role    TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    cost_usd      DECIMAL(10,6),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Migration 004: MCP tool registry
CREATE TABLE swarm_mcp_servers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT UNIQUE NOT NULL,
    url        TEXT NOT NULL,
    tools      JSONB,
    enabled    BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Redis Keys

| Key Pattern | Purpose |
|-------------|---------|
| `redteam:throttle:{mission_id}` | Mission throttle token bucket state |
| `redteam:workspace:{mission_id}` | Workspace path and file manifest |
| `redteam:cost:{mission_id}` | Running cost accumulator (INCRBYFLOAT) |
| `redteam:coverage:{mission_id}` | OWASP category bitmask (SETBIT) |
| `redteam:auth:{mission_id}:verified` | Authorization verified flag |
| `campaign:{campaign_id}:shared_intel` | Cross-target shared intelligence |

### 3.3 Qdrant Collections

| Collection | Purpose |
|------------|---------|
| `hack_docs` | Hacking knowledge RAG |
| `mission_learnings` | Per-stack exploit strategy memory |
| `playbooks` | YAML playbook embeddings |
| `stack_fingerprints` | Tech stack embeddings for similarity search |

---

## Part 4 — Testing Strategy

### 4.1 Testing by Sprint

| Sprint | Test Requirements |
|--------|------------------|
| Sprint 1 | All existing tests pass. Add Critic correlation + should_continue() tests. |
| Sprint 2 | RAG precision@5 > 0.7. Auth agent unit tests. Workspace isolation test. |
| Sprint 3 | Crawler schema validation. API discovery ground truth on Juice Shop. CVE rate limiting. |
| Sprint 4 | Coach diff = valid Python. Engineer tools pass Bandit (zero HIGH). Vector recall < 200ms. |
| Sprint 5 | WebSocket events complete. Report templates pass schema. Campaign intel isolation. |

### 4.2 Mandatory Safety Tests (Every Sprint)

| Test | Expected Behavior |
|------|------------------|
| Authorization bypass | No auth context → raise + log, never execute |
| Scope enforcement | Target outside scope → reject at preflight |
| HITL bypass | Destructive pattern → pause for approval, never auto-execute |
| Budget enforcement | max_cost_usd=0.001 → terminate after first LLM call |
| Workspace isolation | Concurrent missions → separate directories, no collisions |
| Engineer tool safety | os.system() in generated tool → rejected by Bandit |

---

## Part 5 — Dependency Graph & Rollout Sequence

### 5.1 Feature Dependencies

| Feature | Unblocks |
|---------|----------|
| Fix 2: should_continue() | All multi-mission modes; Sprint 5 cost tracker |
| Fix 3: AuthorizationContext | Live missions; MCP; Campaign mode |
| Fix 6: Critic correlation | Coach accuracy; mission learning quality |
| RAG store (2.1) | Per-agent doc injection; Coach; Playbooks |
| Mission workspace (2.3) | Engineer tool output; Crawler; API storage |
| Auth agent (2.2) | Token chaining; Two-phase exploit precision |
| Crawler agent (3.1) | API discovery; OWASP classification |
| Intel agent (3.3) | CVE-driven Gamma selection; PoC synthesis |
| Coach + labs (4.1) | Prompt improvement; Refiner baseline |
| Vector memory (4.2) | Stack strategy recall; Campaign intel |
| Engineer agent (4.3) | Custom tools; Plugin SDK |
| Dashboard (5.1) | Cost visibility; Coverage; Stakeholder reporting |

### 5.2 Recommended Rollout

| Weeks | Work |
|-------|------|
| 1-2 | All 7 fixes. Full test suite. Deploy to staging. |
| 3-4 | RAG ingestion + Mission workspace (infra, low risk). |
| 5-6 | Budget state + Auth agent. Schema migration. Test on Juice Shop. |
| 7-8 | Crawler + API discovery. Update Dockerfile.sandbox. |
| 9-10 | Intel agent + Stack fingerprinting. NVD API integration. |
| 11-14 | Coach + Synthetic labs. 10 training missions. Analyze before committing patches. |
| 15-16 | Vector memory + Playbooks. Populate from training history. |
| 17-18 | Engineer + Refiner. HITL strictly. Staging only. |
| 19-22 | Dashboard, MCP, reports, campaign, plugin SDK. |

---

## Part 6 — Summary & Key Decisions

### 6.1 Change Summary

| Category | Count |
|----------|-------|
| Critical bug fixes | 7 |
| New agent types | 5 (Delta Auth, Beta Crawler, Intel, Coach, Engineer) |
| New core modules | 6 (RAG, Throttle, Workspace, MCP Adapter, Memory, Report Optimizer) |
| State schema additions | 12 fields |
| New Supabase tables | 4 |
| New Redis key patterns | 6 |
| New Qdrant collections | 4 |
| New API endpoints | 8 |
| New WebSocket events | 6 |
| Total development weeks | 22 |

### 6.2 Key Architectural Decisions

1. **Authorization is a hard gate, not a flag** — Enforced as first graph node with exception that terminates mission.

2. **Model tiers are non-negotiable** — Commander uses reasoning-class models. Code models only for Gamma. Enforced by startup assertions.

3. **Engineer agent has mandatory HITL gate** — No auto-registration. Every tool requires human review + Bandit.

4. **Budget/time signals replace iteration counting** — Primary termination signals: cost, time, stall count, coverage quality.

5. **Workspace isolation is first-class** — Every mission gets isolated filesystem namespace from start.

---

## Open Questions / TODO

1. [ ] Implement `verify_vdp_scope()` function
2. [ ] Implement `verify_checksum()` function
3. [ ] Define `chunk_markdown()` for RAG ingestion
4. [ ] Implement `file_tree` tool for static mode
5. [ ] Add error handling for RAG retrieval failures
6. [ ] Clarify partial authorization handling (multi-domain scope)
7. [ ] Add `expected_output_fragment` and `baseline_response` to Gamma's exploit result schema
