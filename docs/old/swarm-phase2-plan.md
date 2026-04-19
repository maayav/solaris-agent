SWARM ARCHITECTURE
Remediation & Phase 2 Implementation Master Plan
Red Team  ·  Multi-Agent  ·  LangGraph  ·  Bug Bounty Platform
Document Purpose: This document addresses every identified deficiency in the current Swarm architecture and provides an exhaustive, sprint-by-sprint implementation roadmap for Phase 2 enhancements. It is intended as the authoritative engineering reference for all development work on the platform.
Scope: Covers 7 critical bug fixes, 25+ feature implementations across 5 development sprints, code-level specifications, state schema changes, database migrations, new agent designs, and security controls.

PART 1 — IDENTIFIED ISSUES & REMEDIATION PLAN
7 critical problems catalogued with root cause analysis and exact fixes
Issues Inventory
Issue / Feature	Priority	Effort	Description
LLM Model Mismatch	CRITICAL	S	Commander uses coding model for strategic planning; env vs docs inconsistency
should_continue() Bluntness	CRITICAL	S	No cost, time, or quality signals — all missions terminate identically
Authorization Proof Gap	CRITICAL	M	No real enforcement of scope/authorization before missions launch
Static Mode Underspecified	HIGH	M	Alpha's static mode behavior is undocumented; shares code path with live mode
Worker Script Debt	HIGH	S	Two worker scripts coexist with no migration path documented
Critic False Positives	HIGH	S	HTTP 500 rule too broad; inflates reported success rates
Stealth / Rate Control	MED	M	No coordinated throttling strategy, IDS avoidance, or stealth modes
Fix 1 — LLM Model Architecture (CRITICAL)
Root Cause
The Commander agent is configured to fall back to qwen2.5-coder:7b-instruct — a 7B model optimized for code generation — when doing strategic mission planning. This is a category error. Code-optimized small models produce poor multi-step strategic reasoning. Additionally, the AGENT_ROLES table in the docs cites Qwen3-235B while .env shows deepseek-r1-0528, creating silent divergence between documentation and runtime behavior.
Fix: Dedicated Model Tiers
Establish three distinct model tiers with no overlap:
Agent	Recommended Model
Commander (Strategic)	openrouter:anthropic/claude-3.5-haiku or deepseek/deepseek-r1 (reasoning-class)
Alpha Recon (Analytical)	openrouter:google/gemini-flash-1.5 or ollama:qwen2.5:14b
Gamma Exploit (Code)	ollama:qwen2.5-coder:14b-instruct (code-optimized, local)
Critic (Evaluator)	ollama:qwen2.5:7b (fast, factual, local)
Report Generator	openrouter:claude-3.5-haiku (structured output quality)
Config Changes
# .env — Corrected model assignments
COMMANDER_MODEL=openrouter:deepseek/deepseek-r1-0528:free
COMMANDER_MODEL_FALLBACK=openrouter:google/gemini-flash-1.5-exp:free
COMMANDER_MODEL_FINAL_FALLBACK=ollama:qwen2.5:14b  # NOT coder variant

ALPHA_MODEL=openrouter:google/gemini-flash-1.5-exp:free
ALPHA_MODEL_FALLBACK=ollama:qwen2.5:14b

GAMMA_MODEL=ollama:qwen2.5-coder:14b-instruct
GAMMA_MODEL_FALLBACK=ollama:qwen2.5-coder:7b-instruct

CRITIC_MODEL=ollama:qwen2.5:7b
REPORT_MODEL=openrouter:deepseek/deepseek-r1-0528:free
Update core/llm_client.py to load these per-agent, and add an assertion at startup that validates Commander is NOT using a -coder model variant.
Fix 2 — should_continue() Intelligence Upgrade (CRITICAL)
Root Cause
The current routing function checks only phase and iteration. A mission that discovered a critical RCE in iteration 1 takes the same path as one that found nothing in 5 iterations. There is no cost awareness, no quality signal, and no time budget — making the system unable to self-regulate.
Fix: Multi-Signal Routing
# agents/state.py — New state fields
class RedTeamState(TypedDict):
    # ... existing fields ...
    # Budget Controls (NEW)
    cost_usd: float              # Accumulated LLM API cost
    max_cost_usd: float          # Hard budget ceiling (default: $2.00)
    started_at: str              # ISO timestamp for time budget
    max_duration_seconds: int    # Wall-clock limit (default: 3600)
    # Quality Signals (NEW)
    critical_findings_count: int # Findings of severity CRITICAL
    high_findings_count: int     # Findings of severity HIGH
    coverage_score: float        # 0.0-1.0 OWASP categories tested
    stall_count: int             # Consecutive iterations with 0 new findings
    max_stall_count: int         # Stall limit before early exit (default: 2)
# agents/graph.py — New should_continue()
def should_continue(state: RedTeamState) -> str:
    phase      = state.get('phase')
    iteration  = state.get('iteration', 0)
    max_iter   = state.get('max_iterations', 5)
    cost       = state.get('cost_usd', 0.0)
    max_cost   = state.get('max_cost_usd', 2.0)
    stall      = state.get('stall_count', 0)
    max_stall  = state.get('max_stall_count', 2)
    started    = state.get('started_at')
    max_dur    = state.get('max_duration_seconds', 3600)
    criticals  = state.get('critical_findings_count', 0)

    # Hard stops
    if phase == 'complete':          return 'report'
    if iteration >= max_iter:         return 'report'
    if cost >= max_cost:              return 'report'   # budget exhausted
    if stall >= max_stall:            return 'report'   # no new intel

    # Time budget check
    if started:
        elapsed = (datetime.utcnow() - datetime.fromisoformat(started)).seconds
        if elapsed >= max_dur:        return 'report'

    # Early success: critical finding + 3+ OWASP categories covered
    coverage = state.get('coverage_score', 0.0)
    if criticals >= 1 and coverage >= 0.3:
        if iteration >= 2:            return 'report'  # enough, move to report

    # Normal routing
    if phase == 'exploitation':       return 'exploit_only'
    return 'continue'
Update Commander's OBSERVE_PROMPT to increment stall_count when no new findings are detected, and reset it to 0 when new findings appear. Token cost should be tracked in core/llm_client.py via OpenRouter's usage response field.
Fix 3 — Authorization Enforcement Gate (CRITICAL)
Root Cause
The HITL gate only fires for destructive payloads mid-mission. There is no pre-flight check that the operator actually has authorization to test the target. A needs_human_approval flag in state is insufficient — it can be bypassed by setting the flag programmatically.
Fix: AuthorizationContext schema + pre-flight gate
# agents/schemas.py — New AuthorizationContext
class AuthorizationContext(BaseModel):
    type: Literal['vdp', 'pentest_contract', 'ctf', 'private_lab']
    evidence_url: str | None      # Link to HackerOne/Intigriti VDP or contract
    scope_domains: list[str]      # Explicitly permitted domains/IPs
    excluded_domains: list[str]   # Explicitly excluded
    authorized_by: str            # Operator name/email
    authorized_at: str            # ISO timestamp
    expiry: str | None            # Authorization expiry if applicable
    checksum: str                 # SHA256 of the above fields to detect tampering
# agents/graph.py — Pre-flight node (first node in graph)
async def preflight_authorization(state: RedTeamState) -> RedTeamState:
    auth = state.get('authorization')  # Must be provided at mission creation
    target = state['target']

    if not auth:
        raise AuthorizationError('No authorization context provided. Refusing to start.')

    # Validate target is within declared scope
    if not any(domain in target for domain in auth.scope_domains):
        raise AuthorizationError(f'Target {target} not in authorized scope {auth.scope_domains}')

    # Validate VDP URL is reachable (live check for vdp type)
    if auth.type == 'vdp' and auth.evidence_url:
        await verify_vdp_scope(auth.evidence_url, target)  # fetches + parses policy

    # Verify checksum integrity
    if not verify_checksum(auth):
        raise AuthorizationError('Authorization context checksum mismatch — possible tampering')

    state['authorization_verified'] = True
    return state
The graph MUST route through preflight_authorization as its first node. Any AuthorizationError terminates the mission immediately with no tool execution. This is logged to the audit table in Supabase. Additionally, Commander's OBSERVE_PROMPT must check scope on every new target it considers.
Fix 4 — Static Mode Specification (HIGH)
Root Cause
Static mode (GitHub repos, local paths) is mentioned in detect_target_type() but Alpha's actual behavior in static mode is not documented or well-separated from live mode. The Blue Team Bridge is used, but it's unclear what Alpha does independently.
Fix: Explicit Static Mode Agent Behavior
Phase	Static Mode Behavior
Alpha Recon	Clone/fetch repo, run Semgrep + Bandit + trufflehog for secrets, map file structure, identify framework from package files
Gamma Exploit	Generate PoC scripts for identified code paths — do NOT execute network requests, only produce curl commands + repro scripts
Critic	Evaluate static findings by CVSS score + reachability analysis, not HTTP status codes
Blue Team Bridge	Primary intel source in static mode — enriches Alpha with existing SAST results
Report	Include file:line references, CWE IDs, and remediation diffs
# agents/alpha_recon.py — Static mode tool dispatch
STATIC_TOOLS = ['semgrep', 'bandit', 'trufflehog', 'code_search', 'file_tree']
LIVE_TOOLS   = ['nmap', 'nuclei', 'curl', 'ffuf', 'sqlmap', 'jwt_tool']

async def alpha_recon(state: RedTeamState):
    mode = state.get('mode') or detect_target_type(state['target'])
    tools = STATIC_TOOLS if mode == 'static' else LIVE_TOOLS
    # LLM selects from appropriate tool subset only
    ...
Fix 5 — Worker Script Debt Resolution (HIGH)
Root Cause
Both swarm_worker.py and swarm_worker_new.py exist with no documented difference. This implies an incomplete migration that creates confusion about which is canonical and risks diverging behavior in production.
Fix
Step 1: Diff the two files and document the delta in a MIGRATION_NOTES.md in the scripts folder.
Step 2: Merge the improvements from _new into the canonical swarm_worker.py
Step 3: Delete swarm_worker_new.py and commit with an explicit 'merge worker scripts' message.
Step 4: Update all references in docker-compose.yml, systemd service files, and README.md to point to the canonical script.
Rule Going Forward
Feature branches for worker changes must be developed against the canonical file. No _new, _v2, or _backup suffixes in production code paths.
Fix 6 — Critic False Positive Reduction (HIGH)
Root Cause
The rule 'HTTP 500 on injection = server crash = success' is too broad. Many applications return 500 for unrelated infrastructure reasons (missing env vars, upstream service failures, middleware exceptions). This inflates apparent success rates and wastes subsequent exploitation cycles.
Fix: Correlated Success Criteria
# agents/critic_agent.py — Tightened deterministic rules
def deterministic_evaluate(result: ExploitResult) -> CriticVerdict:
    status = result.http_status
    body   = result.response_body
    vuln   = result.vulnerability_type

    # SQLi: 500 is success ONLY if body contains DB error signatures
    if vuln == 'sqli' and status == 500:
        db_errors = ['syntax error', 'mysql', 'pg error', 'ORA-', 'sqlite']
        if not any(e.lower() in body.lower() for e in db_errors):
            return CriticVerdict(success=False, reason='500 without DB error — likely unrelated')

    # Command injection: 500 is success only if command output present in body
    if vuln == 'cmdi' and status == 500:
        if not result.expected_output_fragment in body:
            return CriticVerdict(success=False, reason='500 without command output')

    # IDOR: require content divergence between IDs
    if vuln == 'idor' and status == 200:
        if result.baseline_response == body:
            return CriticVerdict(success=False, reason='IDOR: identical response to baseline — no data divergence')

    # Auth bypass: require privilege indicator in response
    if vuln == 'auth_bypass' and status in (200, 201):
        priv_tokens = ['admin', 'role":"admin', 'is_admin":true', 'superuser']
        if not any(t in body.lower() for t in priv_tokens):
            return CriticVerdict(success=False, reason='Auth: 200 but no privilege escalation evidence')

    return CriticVerdict(success=True)
Gamma must now include expected_output_fragment and baseline_response in its exploit result schema so Critic can perform correlation checks.
Fix 7 — Stealth & Rate Control Strategy (MED)
Root Cause
Nuclei is rate-limited to 50 rps, but there is no coordinated throttling across all tools simultaneously. Multiple tools running in parallel (nmap + nuclei + ffuf + curl) can aggregate to rates that trigger IDS/WAF alerts regardless of individual limits.
Fix: Unified Throttle Controller
# core/throttle.py — NEW
class MissionThrottle:
    """Coordinates request rates across all tools in a mission."""
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
            yield   # tool executes here
All sandbox tool executions must acquire a token from MissionThrottle before execution. The throttle mode is set per-mission in RedTeamState and defaults to 'normal'. Stealth mode is automatically engaged if WAF blocks are detected.

PART 2 — PHASE 2 IMPLEMENTATION ROADMAP
25 features across 5 sprints — 22 weeks total
Implementation Roadmap Overview
The following roadmap is organized into five sprints with explicit dependencies. Sprints 1 and 2 must be completed before any downstream sprint work begins, as they establish foundational infrastructure (RAG store, budget state, auth model) that all subsequent features depend on.
Sprint	Focus
Sprint 1 — Weeks 1-2	All 7 critical fixes from Part 1
Sprint 2 — Weeks 3-6	RAG knowledge base, budget state, Auth agent
Sprint 3 — Weeks 7-10	Web crawler agent, OSINT/CVE intel, stack fingerprinting
Sprint 4 — Weeks 11-16	Coach agent, synthetic labs, vector memory, tool pipeline
Sprint 5 — Weeks 17-22	Dashboard upgrade, MCP adapters, report templates, plugin SDK
Sprint 1 — Critical Fixes  ·  Weeks 1–2
✓  Resolve all 7 issues catalogued in Part 1
✓  Merge worker scripts, enforce model tiers
✓  Deploy AuthorizationContext schema to Supabase
✓  Implement unified MissionThrottle
✓  Harden Critic correlation checks
✓  Zero regressions on existing test suite
Sprint 2 — Core Foundation  ·  Weeks 3–6
✓  Hacking Knowledge RAG (OWASP, HackTricks, PayloadsAllTheThings)
✓  Budget/timebox state fields + intelligent should_continue()
✓  Dedicated Auth Agent with session/JWT/cookie attack specialization
✓  Mission-local workspace /workspace/{mission_id}
✓  Per-agent RAG document injection in system prompts
Sprint 3 — Intelligence & Targeting  ·  Weeks 7–10
✓  Web crawling agent (Playwright-based, sitemap generation)
✓  Dynamic API discovery (JS parsing, pseudo-OpenAPI output)
✓  OSINT/Intel agent (CVE/NVD/Exploit-DB integration)
✓  Stack fingerprinting (Wappalyzer-style, framework-specific wordlists)
✓  Bounty policy agent (VDP scope parsing, scope-constrained Commander)
Sprint 4 — Self-Improvement Loop  ·  Weeks 11–16
✓  Coach agent + synthetic lab missions (Juice Shop / DVWA)
✓  Qdrant vector memory for per-stack exploit strategy recall
✓  Engineer agent for dynamic tool generation (with HITL-gated registration)
✓  Refiner agent for statistical tool performance improvement
✓  Pattern library / playbook system (YAML-based per vulnerability class)
Sprint 5 — Platform & Ecosystem  ·  Weeks 17–22
✓  Dashboard upgrades: timeline visualization, agent thought stream, coverage heatmap
✓  MCP tool adapters via LangChain MCP integration
✓  Report Optimizer: HackerOne/Intigriti formatted PoC templates
✓  Multi-target campaign mode with parallel asset management
✓  Plugin SDK for user-contributed recon modules

SPRINT 2 DEEP DIVE — Core Foundation
The three features that unlock everything else
Feature 2.1 — Hacking Knowledge RAG
Architecture
Build a vector store (Qdrant) pre-loaded with structured security knowledge. Each document is tagged with metadata that allows per-agent, per-vulnerability retrieval. This replaces the current approach of hoping the LLM has internalized this knowledge during training.
Knowledge Sources to Index
Source	Content
OWASP Testing Guide	Per-category test cases, payloads, bypass techniques
HackTricks	Tool usage, platform-specific techniques, CTF patterns
PayloadsAllTheThings	Payload lists for SQLi, XSS, SSRF, XXE, etc.
PortSwigger Web Academy	Lab-proven techniques with step-by-step context
NVD CVE Database	Vulnerability descriptions with affected version ranges
Exploit-DB PoC Archive	Working proof-of-concept scripts by CVE/platform
Implementation
# core/rag_store.py — NEW
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

    async def inject_into_prompt(self, base_prompt: str, agent_role: str,
                                  context: str) -> str:
        docs = await self.retrieve(context, agent_role, limit=3)
        knowledge = '
'.join(f'[{d.source}] {d.content}' for d in docs)
        return f'RELEVANT SECURITY KNOWLEDGE:
{knowledge}

{base_prompt}'
Ingestion Pipeline
# scripts/ingest_hack_docs.py — Run once + scheduled weekly refresh
async def ingest_payloads_all_the_things():
    # Clone PAT repo, parse markdown files, chunk by technique
    for vuln_dir in Path('PayloadsAllTheThings').iterdir():
        for md_file in vuln_dir.glob('*.md'):
            chunks = chunk_markdown(md_file, max_tokens=512)
            for chunk in chunks:
                await rag.upsert(HackDoc(
                    content=chunk.text,
                    source='PayloadsAllTheThings',
                    vuln_class=vuln_dir.name,
                    agent_roles=['gamma', 'alpha'],
                    tags=chunk.tags
                ))
Feature 2.2 — Auth Agent
Design Rationale
Authentication attacks are currently scattered across Gamma's exploit arsenal. JWT manipulation, session fixation, OAuth flows, credential stuffing, and SAML attacks all have fundamentally different reconnaissance requirements and tool chains. A dedicated Auth Agent allows these to be developed, tested, and improved independently.
Agent Specification
Attribute	Value
Agent ID	delta_auth
Primary Model	ollama:qwen2.5-coder:14b-instruct
Phase	Runs after Alpha recon, before Gamma exploitation
Input	Discovered endpoints, login forms, auth headers from blackboard
Output	discovered_credentials dict (JWTs, cookies, API keys, session tokens)
Tools	curl, jwt_tool, python_exec, web_search
HITL Required	Yes — for credential stuffing against real user accounts
Attack Arsenal
# agents/delta_auth.py — NEW
AUTH_ATTACK_VECTORS = {
    'jwt_none_alg':     'Change algorithm to none, remove signature',
    'jwt_weak_secret':  'Brute-force HS256 with rockyou subset',
    'jwt_kid_sqli':     'Inject SQL into kid header parameter',
    'oauth_implicit':   'Probe for implicit flow token leakage',
    'saml_xxe':         'Inject XXE payload into SAML assertion',
    'session_fixation': 'Pre-set session ID before authentication',
    'default_creds':    'Test admin/admin, root/root, platform defaults',
    'password_spray':   'Low-rate spray against common passwords (HITL-gated)',
    'api_key_enum':     'Enumerate API key patterns in JS source',
    'sso_bypass':       'Test SSO assertion manipulation',
}

AUTH_PLAN_PROMPT = '''
You are Delta, an authentication attack specialist.
DISCOVERED AUTH SURFACES: {auth_surfaces}
RELEVANT KNOWLEDGE: {rag_context}
Analyze each surface and select the 3 most promising attack vectors.
Return: [{{'vector': ..., 'target_endpoint': ..., 'tool': ..., 'payload': ...}}]
'''
Token Propagation
Successful credentials discovered by Delta are written to the blackboard under discovered_credentials and automatically available to Gamma's two-phase execution system. This formalizes the existing ad-hoc credential sharing that was previously done inside Gamma.
Feature 2.3 — Mission-Local Workspace
Problem
All scripts, wordlists, and intermediate files currently share a global path. Parallel missions on different targets will collide. The mission-local workspace gives each mission an isolated filesystem namespace.
# sandbox/workspace.py — NEW
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
        # Copy stack-appropriate base wordlists from /opt/wordlists/
        await self._seed_wordlists()

    async def cleanup(self, keep_reports=True):
        # Retain reports, delete working files after mission
        shutil.rmtree(self.scripts, ignore_errors=True)
        shutil.rmtree(self.lists,   ignore_errors=True)

    def path(self, *parts) -> str:
        """Return absolute path within workspace for sandbox exec."""
        return str(self.root.joinpath(*parts))
The RedTeamState schema gets a workspace_path: str field populated at mission initialization. All tool calls that write files must use workspace.path(...) instead of hardcoded paths.

SPRINT 3 DEEP DIVE — Intelligence & Targeting
Crawler, API discovery, OSINT, CVE integration
Feature 3.1 — Web Crawling Agent
Infrastructure Requirement
Dependency
Requires Playwright installation in the Kali sandbox image: apt-get install -y playwright && playwright install chromium. Add to Dockerfile.sandbox.
Crawler Agent Specification
# agents/crawler_agent.py — NEW
class CrawlerAgent:
    """Beta agent: discovers site structure before Alpha recon."""

    async def crawl(self, target: str, depth: int = 3) -> SiteMap:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            page    = await browser.new_page()

            # Intercept all network requests
            requests = []
            page.on('request', lambda r: requests.append({
                'url': r.url, 'method': r.method, 'headers': dict(r.headers)
            }))

            await page.goto(target)
            await page.wait_for_load_state('networkidle')

            # Extract forms
            forms = await page.evaluate('''() =>
                [...document.forms].map(f => ({
                    action: f.action, method: f.method,
                    fields: [...f.elements].map(e => ({name: e.name, type: e.type}))
                }))''')

            # Classify endpoints
            sitemap = SiteMap(target=target, forms=forms, requests=requests)
            sitemap.classify_owasp()  # Tag each endpoint with likely OWASP categories
            return sitemap
The Crawler agent is inserted as a new graph node beta_crawl between preflight_authorization and commander_plan. Its output enriches the blackboard before the Commander generates task assignments, giving Alpha better-targeted reconnaissance directives.
Feature 3.2 — Dynamic API Discovery
JS Bundle Analysis
# tools/api_discovery.py — NEW
async def discover_api_endpoints(target: str, workspace: MissionWorkspace):
    # Step 1: Fetch all JS bundles referenced in the HTML
    bundles = await fetch_js_bundles(target)

    # Step 2: Extract URL patterns via regex + AST analysis
    patterns = []
    for bundle in bundles:
        # Regex: fetch('/api/...'), axios.get('/...'), '/endpoint'
        patterns += re.findall(r'''['"](\/[a-z0-9_\-\/{}:]+)['"]''', bundle)
        # AST: parse with pyjsparser for dynamic route construction
        patterns += extract_routes_from_ast(bundle)

    # Step 3: Deduplicate and parameterize
    endpoints = normalize_endpoints(patterns, base_url=target)

    # Step 4: Generate pseudo-OpenAPI spec
    spec = generate_openapi_stub(endpoints)
    await workspace.write('discovered_api.json', spec.json())

    # Step 5: Write to blackboard
    await blackboard.set('discovered_api', spec.dict())
    return spec
Feature 3.3 — Intel / CVE Agent
Architecture
The Intel agent fires after Alpha's stack fingerprinting phase. Once the target's framework, CMS, and library versions are known, Intel synthesizes CVE/NVD lookups into actionable exploit directives for Commander and Gamma.
# agents/intel_agent.py — NEW
async def intel_agent(state: RedTeamState) -> RedTeamState:
    stack = state['blackboard'].get('stack_fingerprint', {})

    findings = []
    for component, version in stack.items():
        # NVD API v2.0
        cves = await nvd_search(f'{component} {version}')

        # Exploit-DB lookup
        exploits = await exploitdb_search(component, version)

        for cve in cves[:3]:   # top 3 by CVSS score
            poc = await synthesize_poc(cve, component, version)
            findings.append(IntelFinding(
                cve_id=cve.id, component=component,
                cvss=cve.cvss_score, poc=poc,
                exploit_db_url=exploits[0].url if exploits else None
            ))

    # Write prioritized findings to blackboard
    await blackboard.set('cve_intel', [f.dict() for f in
        sorted(findings, key=lambda x: x.cvss, reverse=True)])
    return state

SPRINT 4 DEEP DIVE — Self-Improvement Loop
Coach agent, synthetic labs, vector memory, Engineer + Refiner
Feature 4.1 — Coach Agent & Synthetic Lab Missions
Design
The Coach agent addresses the fundamental limitation that the swarm only learns within a single mission. By running structured training missions against Juice Shop and DVWA, Coach can analyze systematic failure patterns and rewrite the prompts and heuristics that cause them.
Component	Description
Training Targets	OWASP Juice Shop (Node.js), DVWA (PHP), WebGoat (Java) — all run locally via docker-compose
Mission Runner	Automated script runs 10 training missions per target with logging
Failure Analysis	Coach LLM analyzes missed vulnerabilities, root cause, and agent responsible
Prompt Rewriting	Coach proposes prompt patches as diffs against current PLAN/OBSERVE prompts
HITL Gate	Human reviews and approves prompt patches before they are committed to codebase
Regression Testing	Re-run training missions after patch to verify improvement
# agents/coach_agent.py — NEW
COACH_ANALYSIS_PROMPT = '''
You are Coach, responsible for improving the swarm's effectiveness.

TRAINING MISSION RESULTS:
{mission_results}

KNOWN VULNERABILITIES IN THIS TARGET:
{ground_truth_vulns}

MISSED VULNERABILITIES:
{missed}

For each missed vulnerability:
1. Identify which agent was responsible for detecting/exploiting it
2. Determine the root cause (prompt gap, missing tool, wrong model, bad heuristic)
3. Propose a specific prompt patch or heuristic change
4. Predict expected improvement as percentage

Return JSON: [{{'agent': ..., 'vuln': ..., 'root_cause': ..., 'patch': ..., 'expected_gain': ...}}]
'''
Feature 4.2 — Qdrant Vector Memory
Design
Beyond RAG for static documentation, the vector memory stores learnings from real missions. When the swarm encounters a new target, it retrieves strategies that worked on similar stacks in past missions — giving the system genuine long-term memory.
# core/qdrant_memory.py — EXTEND existing file
class MissionMemory:
    COLLECTION = 'mission_learnings'

    async def store_learning(self, mission_id: str,
                             stack_fingerprint: dict,
                             successful_exploits: list[dict]):
        for exploit in successful_exploits:
            doc = MissionLearning(
                mission_id=mission_id,
                stack=stack_fingerprint,
                vuln_class=exploit['type'],
                payload=exploit['payload'],
                tool=exploit['tool'],
                endpoint_pattern=exploit['endpoint_pattern'],
                cvss=exploit['cvss'],
            )
            embedding = self.encoder.encode(
                f"{stack_fingerprint.get('framework')} {exploit['type']} {exploit['endpoint_pattern']}"
            )
            await self.client.upsert(self.COLLECTION, [doc], [embedding])

    async def recall_strategies(self, stack: dict, vuln_class: str) -> list[MissionLearning]:
        query = f"{stack.get('framework')} {stack.get('version')} {vuln_class}"
        return await self.search(self.COLLECTION, query, limit=5)
Feature 4.3 — Engineer Agent (Tool Pipeline)
Design & Safety Controls
Critical Safety Note
The Engineer agent can generate and register new tools at runtime. This is a HIGH-RISK capability. All generated tools must pass: (1) static analysis with Bandit, (2) HITL human review, (3) sandboxed test execution with no network access, before registration. Auto-registration without HITL is explicitly prohibited.
# agents/engineer_agent.py — NEW
TOOL_GENERATION_PIPELINE = [
    'generate_code',      # LLM writes tool based on specification
    'static_analysis',    # Bandit + safety checks
    'hitl_review',        # Human approves tool before it can be registered
    'sandbox_test',       # Execute in network-isolated sandbox
    'register',           # Add to ToolRegistry with performance metadata
]

ENGINEER_PROMPT = '''
You are Engineer. Write a Python tool function for the following task:
TASK: {task_description}
TARGET CONTEXT: {target_stack}

Requirements:
- Single async function with signature: async def run(**kwargs) -> ExecResult
- Use only stdlib + {allowed_packages}
- Include docstring with: purpose, args, expected output
- NO hardcoded credentials, IPs, or sensitive data
- NO file writes outside /workspace/{mission_id}/
'''

SPRINT 5 DEEP DIVE — Platform & Ecosystem
Dashboard, MCP, reporting, multi-target, plugin SDK
Feature 5.1 — Dashboard Upgrades
New Components
Component	Description
Mission Timeline	Gantt-style swimlane showing each agent's activity over time with finding annotations
Agent Thought Stream	Real-time display of LLM reasoning steps (streamed via WebSocket)
OWASP Coverage Heatmap	Grid showing which of OWASP A01-A10 have been tested, with color-coded confidence
Kill Chain Progress	Visual kill chain: Recon → Weaponize → Deliver → Exploit → Post-Exploit
Cost Tracker	Live LLM API cost accumulation vs. budget ceiling
Finding Severity Breakdown	Donut chart: CRITICAL / HIGH / MED / LOW / INFO counts
WebSocket Event Extensions
# New events to emit via api/main.py
AGENT_THOUGHT    = 'agent_thought'      # LLM reasoning step (streamed tokens)
COST_UPDATE      = 'cost_update'        # {'agent': ..., 'cost_usd': ..., 'total': ...}
COVERAGE_UPDATE  = 'coverage_update'    # {'owasp_category': ..., 'tested': True/False}
STALL_WARNING    = 'stall_warning'      # {'stall_count': ..., 'max_stall': ...}
BUDGET_WARNING   = 'budget_warning'     # {'cost_pct': 0.85}  — at 85% of budget
AUTH_FOUND       = 'auth_credential'    # {'type': 'jwt', 'value_hash': ...}  — no plaintext
Feature 5.2 — MCP Tool Adapters
Design
Integrate LangChain's MCP adapter layer to allow the swarm to consume external pentest-specialized MCP servers as native tools. This means any MCP-compatible security tool can be dynamically added to a mission without code changes.
# core/mcp_adapter.py — NEW
from langchain_mcp_adapters import MCPToolAdapter

class SwarmMCPBridge:
    """Bridges MCP servers into the ToolRegistry."""

    async def register_mcp_server(self, server_url: str, server_name: str):
        adapter = MCPToolAdapter(server_url=server_url)
        tools   = await adapter.list_tools()

        for mcp_tool in tools:
            wrapped = ToolSpec(
                name=f'mcp_{server_name}_{mcp_tool.name}',
                description=mcp_tool.description,
                args_schema=mcp_tool.input_schema,
                execute=lambda **kw: adapter.call(mcp_tool.name, **kw),
                source='mcp',
                server=server_name
            )
            self.registry.register(wrapped)

# Mission config
MCP_SERVERS = [
    {'url': 'http://hexstrike-mcp:8080', 'name': 'hexstrike'},
    {'url': 'http://nuclei-mcp:8081',    'name': 'nuclei_mcp'},
]
Feature 5.3 — Report Optimizer
HackerOne / Intigriti Output Templates
# agents/report_optimizer.py — NEW
HACKERONE_TEMPLATE = '''
## Summary
{one_sentence_summary}

## Steps to Reproduce
{numbered_repro_steps}

## Supporting Material
```
{curl_repro_command}
```

## Impact
{impact_statement}

## Severity
CVSS: {cvss_score} | {cvss_vector}
Severity: {severity}

## Affected Asset
URL: {target_url}
Parameter: {vulnerable_parameter}
'''

async def optimize_report(findings: list[Finding], program: str) -> str:
    template = HACKERONE_TEMPLATE if program == 'hackerone' else INTIGRITI_TEMPLATE
    # LLM rewrites finding in program-specific language + tone
    ...
Feature 5.4 — Multi-Target Campaign Mode
# agents/state.py — Campaign extensions
class CampaignState(TypedDict):
    campaign_id: str
    targets: list[str]              # All assets in scope
    missions: dict[str, str]        # target -> mission_id mapping
    shared_intel: dict[str, Any]    # Cross-target credential reuse, subnet findings
    active_missions: int            # Currently running parallel missions
    max_parallel: int               # Concurrency limit (default: 3)
    completed: list[str]            # Finished targets

# Campaign manager launches missions with shared_intel context,
# so credentials found on target A are automatically tried on target B.

PART 3 — DATABASE & INFRASTRUCTURE CHANGES
Supabase schema migrations, new Redis keys, Qdrant collections
Supabase Schema Migrations
New Tables
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
ALTER TABLE swarm_missions ADD COLUMN max_cost_usd    DECIMAL(10,4) DEFAULT 2.0;
ALTER TABLE swarm_missions ADD COLUMN max_duration_s  INTEGER       DEFAULT 3600;
ALTER TABLE swarm_missions ADD COLUMN stall_count     INTEGER       DEFAULT 0;
ALTER TABLE swarm_missions ADD COLUMN coverage_score  DECIMAL(4,3)  DEFAULT 0;

-- Migration 003: Agent cost ledger
CREATE TABLE swarm_cost_ledger (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id  UUID REFERENCES swarm_missions(id),
    agent_role  TEXT NOT NULL,
    model       TEXT NOT NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    cost_usd      DECIMAL(10,6),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Migration 004: MCP tool registry
CREATE TABLE swarm_mcp_servers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT UNIQUE NOT NULL,
    url         TEXT NOT NULL,
    tools       JSONB,
    enabled     BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
Redis Key Extensions
Key Pattern	Purpose
redteam:throttle:{mission_id}	Mission throttle token bucket state
redteam:workspace:{mission_id}	Workspace path and file manifest
redteam:cost:{mission_id}	Running cost accumulator (INCRBYFLOAT)
redteam:coverage:{mission_id}	OWASP category bitmask (SETBIT)
redteam:auth:{mission_id}:verified	Authorization verified flag (SET)
campaign:{campaign_id}:shared_intel	Cross-target shared intelligence hash
Qdrant Collections
Collection	Purpose
hack_docs	Hacking knowledge RAG (OWASP, HackTricks, PAT)
mission_learnings	Per-stack exploit strategy memory from past missions
playbooks	YAML playbook embeddings for fuzzy technique matching
stack_fingerprints	Normalized tech stack embeddings for similarity search

PART 4 — TESTING STRATEGY
Unit, integration, regression, and safety test requirements
Testing Requirements by Sprint
Sprint	Test Requirements
Sprint 1 (Fixes)	All existing tests must pass with zero regressions. Add specific tests for Critic correlation rules and should_continue() new signals.
Sprint 2 (Foundation)	RAG retrieval accuracy test (precision@5 > 0.7). Auth agent unit tests per attack vector. Workspace isolation test (parallel missions must not share files).
Sprint 3 (Intelligence)	Crawler output schema validation. API discovery vs. known endpoint ground truth on Juice Shop. CVE lookup rate limiting and error handling.
Sprint 4 (Self-improvement)	Coach agent diff output must be valid Python. Engineer agent generated tools must pass Bandit with zero HIGH findings. Vector memory recall latency < 200ms.
Sprint 5 (Platform)	WebSocket events must include all new event types. Report templates must pass HackerOne schema validation. Multi-target campaign must not leak intel between out-of-scope targets.
Safety Tests (Mandatory for Every Sprint)
Authorization bypass test: Attempt to start a mission with no AuthorizationContext — must raise and log, never execute tools.
Scope enforcement test: Provide AuthorizationContext with scope=[example.com], set target=evil.com — must be rejected at preflight.
HITL bypass test: Inject a destructive pattern (DROP TABLE) into a generated payload — must pause for human approval, never auto-execute.
Budget enforcement test: Set max_cost_usd=0.001 — mission must terminate after first LLM call without continuing.
Workspace isolation test: Two concurrent missions with different IDs must write to separate directories with no file collisions.
Engineer tool safety test: Engineer-generated tool with os.system() call must be rejected by Bandit and not registered.

PART 5 — DEPENDENCY GRAPH & ROLLOUT SEQUENCE
What must be built before what
Feature Dependency Map
The following table shows which features unblock which downstream work. Features in Sprint 1 and 2 are foundational — nothing in Sprint 3+ can be fully functional without them.
Feature	Unlocks
Fix 2: should_continue() budget signals	All multi-mission modes; Sprint 5 cost tracker
Fix 3: AuthorizationContext	All live mission execution; MCP servers; Campaign mode
Fix 6: Critic correlation rules	Coach agent accuracy; mission learning quality
RAG store (2.1)	Per-agent doc injection; Coach prompt improvement; Playbook system
Mission workspace (2.3)	Engineer agent tool output; Crawler artifacts; API spec storage
Auth agent (2.2)	Token chaining quality; Two-phase exploit precision
Crawler agent (3.1)	Dynamic API discovery; OWASP classification; Commander targeting
Intel agent (3.3)	CVE-driven Gamma exploit selection; PoC synthesis
Coach + Synthetic labs (4.1)	Prompt quality improvement; Refiner agent baseline
Vector memory (4.2)	Stack-specific strategy recall; Campaign intel sharing
Engineer agent (4.3)	Custom tool generation; Plugin SDK foundation
Dashboard upgrades (5.1)	Cost transparency; Coverage visibility; Stakeholder reporting
Recommended Rollout Sequence
Week 1-2: All 7 fixes. Run full test suite. Deploy to staging. No new features until fixes are green.
Week 3-4: RAG ingestion pipeline + Mission workspace. These are infrastructure with no LLM changes, lower risk.
Week 5-6: Budget state fields + Auth agent. Update state schema, run migration, test in staging against Juice Shop.
Week 7-8: Crawler + API discovery. Requires Playwright in sandbox — update Dockerfile.sandbox and rebuild image.
Week 9-10: Intel agent + Stack fingerprinting. Integrate NVD API (register for key). Test CVE lookup against known vulnerable Juice Shop version.
Week 11-14: Coach + Synthetic labs. Set up training docker-compose with Juice Shop + DVWA. Run 10 training missions. Analyze Coach output before committing any prompt patches.
Week 15-16: Vector memory + Playbook system. Requires training mission history from weeks 11-14 to populate meaningfully.
Week 17-18: Engineer + Refiner agents. Gate behind HITL strictly. Deploy to staging only, not production, for initial rollout.
Week 19-22: Dashboard, MCP adapters, report templates, campaign mode, plugin SDK. Frontend-heavy sprint — can be parallelized with a frontend developer.

PART 6 — SUMMARY & KEY DECISIONS
Executive summary of all changes
Summary of All Changes
Category	Count
Critical bug fixes	7
New agent types	5 (Delta Auth, Beta Crawler, Intel, Coach, Engineer)
New core modules	6 (RAG, Throttle, Workspace, MCP Adapter, Mission Memory, Report Optimizer)
State schema additions	12 new fields
New Supabase tables	4
New Redis key patterns	6
New Qdrant collections	4
New API endpoints	8 (campaign, budget, coverage, MCP config)
New WebSocket events	6
Total development weeks	22
Total sprint count	5
Key Architectural Decisions
1. Authorization is a hard gate, not a flag
Authorization is enforced as the first graph node with an exception that terminates the entire mission. It cannot be set programmatically or bypassed by state manipulation.
2. Model tiers are non-negotiable
Commander must use a reasoning-class model. Code-optimized models are only for Gamma. These are enforced by startup assertions, not convention.
3. Engineer agent has a mandatory HITL gate
No auto-registration of generated tools. Every generated tool must be reviewed by a human and pass Bandit static analysis before being added to the registry.
4. Budget and time signals replace iteration counting
The iteration counter remains as a hard safety ceiling, but the primary termination signals are cost, time, stall count, and coverage quality. This makes mission termination self-aware rather than mechanical.
5. Workspace isolation is a first-class concern
Every mission gets its own filesystem namespace from the start. This unblocks multi-target campaigns and eliminates the risk of parallel missions corrupting each other's working files.
