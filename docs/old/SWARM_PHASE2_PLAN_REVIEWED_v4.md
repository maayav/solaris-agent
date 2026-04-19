# SWARM Phase 2 — Remediation & Implementation Master Plan

**Red Team · Multi-Agent · LangGraph · Bug Bounty Platform**
**Version:** 4.1 (Final)
**Status:** DRAFT — Sprint 0 required before Phase 2 begins

---

## Table of Contents

1. [Part 1: Identified Issues & Remediation](#part-1--identified-issues--remediation)
2. [Part 2: Implementation Roadmap](#part-2--phase-2-implementation-roadmap)
3. [Part 3: Database & Infrastructure](#part-3--database--infrastructure-changes)
4. [Part 4: Testing Strategy](#part-4--testing-strategy)
5. [Part 5: Dependency Graph & Rollout](#part-5--dependency-graph--rollout-sequence)
6. [Part 6: Summary & Key Decisions](#part-6--summary--key-decisions)
7. [Appendix A: RAG Knowledge Sources](#appendix-a--rag-knowledge-sources)
8. [Appendix B: Credential Vault Design](#appendix-b--credential-vault-design)

---

## Critical Preamble — Sprint 0 Required

**The original plan has 7 Open Questions that block Sprint 1 from being production-safe.**

Items 1, 2, 3, and 7 from the Open Questions block the authorization hard gate, which is the single most critical safety mechanism. Shipping a hard auth gate with an undefined checksum function is worse than not shipping it at all — it creates false confidence.

**Recommend: 1-week Sprint 0 to close all TODOs before Phase 2 begins.**

| TODO | Blocks | Priority |
|------|--------|----------|
| Implement `verify_checksum()` | Fix 3 (Auth gate) | CRITICAL |
| Implement `verify_vdp_scope()` | Fix 3 (Auth gate) | CRITICAL |
| Define `chunk_markdown()` | Feature 2.1 (RAG) | HIGH |
| Add XSS/SSRF/PathTrav to Critic | Fix 6 (Critic hardening) | HIGH |
| Restructure `MissionThrottle.acquire()` | Fix 7 (Throttle) | HIGH |
| Define `CredentialContext` schema | Feature 2.2 (Auth agent) | MED |
| Implement `file_tree` tool | Fix 4 (Static mode) | MED |
| Implement `MissionWorkspace.write()` | Feature 2.3 (Workspace) | HIGH |

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
| Critic False Positives | HIGH | S | HTTP 500 rule too broad; XSS/SSRF unchecked |
| Stealth / Rate Control | MED | M | No coordinated throttling; broken async pattern |

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

**Root Cause:** Routing only checks phase/iteration. Also: the plan delegates stall detection to Commander's LLM — if Commander hallucinates or returns malformed JSON, `stall_count` never increments and the stall guard never fires.

**Fix:** Multi-Signal Routing with **deterministic stall detection in the graph layer.**

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
coverage_score: float        # 0.0-1.0 OWASP categories tested
stall_count: int            # Consecutive iterations with 0 new findings
max_stall_count: int        # Stall limit before early exit (default: 2)
previous_findings_hash: str  # Hash of findings at last iteration (for stall detection)
```

**Stall Detection (computed in graph, NOT in LLM):**
```python
import hashlib

def _hash_findings(findings: list) -> str:
    """
    Stable hash of EXPLOIT results only for stall detection.
    
    INTENTIONAL SCOPE: Measures exploitation progress, not recon progress.
    Alpha discovering 10 new endpoints does NOT reset stall_count unless
    Gamma produces new exploit results from them. Recon-only missions
    without exploitation advancement stall after max_stall_count iterations.
    
    To include recon in stall detection, also hash state['recon_findings']:
        current_hash = _hash_findings(
            state.get('exploit_results', []) + 
            state.get('recon_findings', [])
        )
    """
    normalized = sorted([f.get('type', '') + f.get('endpoint', '') for f in findings])
    return hashlib.sha256('|'.join(normalized).encode()).hexdigest()[:16]

def _compute_stall(state: RedTeamState) -> RedTeamState:
    """
    Deterministic stall detection by comparing findings hashes.
    MUST be called at the start of each iteration in commander_observe().
    Updates stall_count and previous_findings_hash in state.
    
    Note: Stall detection activates from iteration 2 onward. The first iteration
    establishes the baseline; stall counting begins on the second iteration
    with no new findings.
    """
    current_hash = _hash_findings(state.get('exploit_results', []))
    prev_hash = state.get('previous_findings_hash', '')
    
    if prev_hash == '':
        # First call — establish baseline, don't count as stall
        state['stall_count'] = 0
    elif current_hash == prev_hash:
        # No new findings — increment stall
        state['stall_count'] = state.get('stall_count', 0) + 1
    else:
        # New findings detected — reset stall
        state['stall_count'] = 0
    
    # Update hash for next iteration comparison
    state['previous_findings_hash'] = current_hash
    
    return state
```

**Wiring in `commander_observe()` (required integration point):**
```python
async def commander_observe(state: RedTeamState) -> RedTeamState:
    """
    Commander observe node — evaluates results and decides next actions.
    """
    # CRITICAL: Compute stall BEFORE should_continue() reads stall_count
    state = _compute_stall(state)
    
    # ... existing LLM reasoning and task assignment logic ...
    
    # NOTE: state['previous_findings_hash'] is now updated for next iteration
    return state
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
    if cost >= max_cost:        return 'report'
    if stall >= max_stall:      return 'report'

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

---

### Fix 3 — Authorization Enforcement Gate (CRITICAL)

**Root Cause:** HITL gate only fires mid-mission. No pre-flight authorization check. `verify_checksum()` is undefined — blocking this critical safety mechanism.

**Fix:** AuthorizationContext + Pre-flight Gate with HMAC-signed checksums.

**Checksum Specification (MUST be defined in Sprint 0):**

```python
import hmac
import hashlib
from typing import Literal

AUTHORIZATION_HMAC_SECRET = os.environ['AUTHORIZATION_HMAC_SECRET']  # Server-side only

def compute_authorization_checksum(auth: 'AuthorizationContext') -> str:
    """
    HMAC-SHA256 of canonicalized authorization fields.
    Uses server-side secret so checksum cannot be forged client-side.
    
    Canonical form: sorted concatenated string of all fields.
    
    NOTE: hmac.digest() is the modern one-shot form (Python 3.7+). hmac.new() also valid.
    """
    fields = [
        auth.type,
        auth.evidence_url or '',
        ','.join(sorted(auth.scope_domains)),
        ','.join(sorted(auth.excluded_domains)),
        auth.authorized_by,
        auth.authorized_at,
        auth.expiry or '',
    ]
    canonical = '|'.join(fields)
    
    # CORRECT: hmac.digest() is the one-shot form. hmac.new() is also valid.
    return hmac.digest(
        AUTHORIZATION_HMAC_SECRET.encode(),
        canonical.encode(),
        'sha256'
    ).hex()

def verify_checksum(auth: 'AuthorizationContext') -> bool:
    """Verify HMAC signature matches computed checksum using constant-time comparison."""
    expected = compute_authorization_checksum(auth)
    # hmac.compare_digest provides timing-attack safe comparison
    return hmac.compare_digest(expected, auth.checksum)
```

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
    checksum: str  # HMAC-SHA256 of above fields
```

**Pre-flight Node (`agents/graph.py`):**
```python
from urllib.parse import urlparse

def _domain_matches(target: str, scope_domain: str) -> bool:
    """
    Check if target domain matches scope domain properly (no substring bypass).
    
    - target: 'https://evil-example.com' + scope_domain: 'example.com' → False
    - target: 'https://example.com' + scope_domain: 'example.com' → True
    - target: 'https://sub.example.com' + scope_domain: 'example.com' → True
    - target: 'https://example.com:8080' + scope_domain: 'example.com' → True
    - target: 'example.com' + scope_domain: 'example.com' → True (bare hostname)
    - target: 'example.com/api/v1' + scope_domain: 'example.com' → True (bare hostname with path)
    """
    try:
        target_host = urlparse(target).netloc.lower()
        if not target_host:
            # Bare hostname without scheme — urlparse treats it as a path
            target_host = target.lower().split('/')[0]  # Strip any trailing path
        
        scope_host = scope_domain.lower().lstrip('*.')
        
        # Remove port if present
        if ':' in target_host:
            target_host = target_host.rsplit(':', 1)[0]
        
        # Exact match or subdomain match
        if target_host == scope_host:
            return True
        if target_host.endswith('.' + scope_host):
            return True
        return False
    except Exception:
        return False

async def preflight_authorization(state: RedTeamState) -> RedTeamState:
    auth = state.get('authorization')
    target = state['target']

    if not auth:
        raise AuthorizationError('No authorization context provided.')

    if not any(_domain_matches(target, d) for d in auth.scope_domains):
        raise AuthorizationError(f'Target {target} not in authorized scope')

    if any(_domain_matches(target, d) for d in auth.excluded_domains):
        raise AuthorizationError(f'Target {target} in excluded domains')

    if auth.type == 'vdp' and auth.evidence_url:
        await verify_vdp_scope(auth.evidence_url, target)

    if not verify_checksum(auth):
        raise AuthorizationError('Authorization checksum mismatch — possible tampering')

    if auth.expiry:
        if datetime.fromisoformat(auth.expiry) < datetime.utcnow():
            raise AuthorizationError('Authorization expired')

    state['authorization_verified'] = True
    return state
```

**VDP Scope Verification (agents/auth_vdp.py):**
```python
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urlparse

async def verify_vdp_scope(evidence_url: str, target: str) -> None:
    """
    Fetch VDP policy page and verify target is in scope.
    
    Raises AuthorizationError if:
    - Policy page is unreachable (404, connection error, Cloudflare block)
    - Target domain is not found in the policy's scope section
    - Policy page is malformed or unparseable
    
    NOTE: This is best-effort verification. Some VDP programs use
    non-standard formats. Failures should be logged but may require
    human review rather than hard rejection in all cases.
    """
    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; security-researcher)'},
            follow_redirects=True,
        ) as client:
            resp = await client.get(evidence_url)
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        raise AuthorizationError(f'VDP policy page unreachable: {evidence_url} — {e}')

    if resp.status_code == 403:
        # Cloudflare/bot protection — log and require manual review
        raise AuthorizationError(
            f'VDP policy page blocked (403) — manual scope verification required: {evidence_url}'
        )
    if resp.status_code != 200:
        raise AuthorizationError(
            f'VDP policy page returned {resp.status_code}: {evidence_url}'
        )

    # Extract target hostname for matching (strip port if present)
    target_host = urlparse(target).netloc or target.split('/')[0]
    if ':' in target_host:
        target_host = target_host.rsplit(':', 1)[0]  # Remove port (e.g., example.com:8080)
    
    # Search policy page text for target domain
    soup = BeautifulSoup(resp.text, 'html.parser')
    page_text = soup.get_text().lower()
    
    if target_host.lower() not in page_text:
        raise AuthorizationError(
            f'Target {target_host} not found in VDP policy page: {evidence_url}'
        )
```

**Dependencies to add:**
```toml
[project.dependencies]
httpx = "^0.27.0"
beautifulsoup4 = "^4.12.0"
```

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

**Root Cause:** `HTTP 500 on injection = success` rule too broad. Also missing XSS, SSRF, and path traversal checks entirely.

**Fix:** Correlated Success Criteria — **including XSS, SSRF, and path traversal with proper encoded-payload handling.**

```python
def deterministic_evaluate(result: ExploitResult) -> CriticVerdict:
    status = result.http_status
    body   = result.response_body.lower()  # Normalize for comparison
    vuln   = result.vulnerability_type

    # SQLi: 500 only if body contains DB error signatures
    if vuln == 'sqli' and status == 500:
        db_errors = ['syntax error', 'mysql', 'pg error', 'ora-', 'sqlite', 'sql syntax']
        if not any(e in body for e in db_errors):
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
        if not any(t in body for t in priv_tokens):
            return CriticVerdict(success=False, reason='Auth: no privilege escalation')

    # XSS: reflected payload — check raw AND URL-encoded variants
    if vuln == 'xss' and status == 200:
        raw_payload = result.injected_payload.lower()
        encoded_payload = result.injected_payload.replace('<', '%3c').replace('>', '%3e')
        
        # Check for reflection of raw or encoded payload
        if raw_payload not in body and encoded_payload.lower() not in body:
            return CriticVerdict(success=False, reason='XSS: payload not reflected')
        
        # Check for execution markers (HTML tags, event handlers, etc.)
        xss_markers = [
            '<script', '<svg', '<iframe', '<img', '<body', '<object', '<embed',
            'javascript:', 'onerror=', 'onload=', 'onmouseover=', 'onfocus=',
            'onblur=', 'onclick=', 'onchange=', 'onsubmit='
        ]
        if not any(marker in body for marker in xss_markers):
            return CriticVerdict(success=False, reason='XSS: payload reflected but no execution markers')

    # SSRF: require out-of-band confirmation or internal asset reference
    if vuln == 'ssrf' and status in (200, 201, 301, 302):
        # Use regex for RFC-1918 private IP detection — avoids matching version strings
        import re
        private_ip_patterns = [
            r'\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b',  # 10.0.0.0/8
            r'\b172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}\b',  # 172.16.0.0/12
            r'\b192\.168\.\d{1,3}\.\d{1,3}\b',  # 192.168.0.0/16
            r'\b169\.254\.\d{1,3}\.\d{1,3}\b',  # Link-local (AWS metadata)
            r'\blocalhost\b',
            r'\binternal\b',
        ]
        has_private_ip = any(re.search(pattern, body) for pattern in private_ip_patterns)
        has_oob_marker = result.expected_ssrf_marker and result.expected_ssrf_marker in body
        
        if not has_private_ip and not has_oob_marker:
            return CriticVerdict(success=False, reason='SSRF: no internal asset reference')

    # Path traversal: require file content or sensitive path confirmation
    if vuln == 'path_traversal' and status == 200:
        pt_indicators = ['root:', 'etc/passwd', 'c:\\windows', '/etc/shadow', 'boot.ini']
        if not any(indicator in body for indicator in pt_indicators):
            return CriticVerdict(success=False, reason='Path traversal: no sensitive content')

    return CriticVerdict(success=True)
```

**OWASP Coverage Tracking (`agents/critic_node.py`):**
```python
import aioredis

OWASP_CATEGORY_MAP = {
    'sqli':           'A03',  # Injection
    'xss':            'A03',
    'cmdi':           'A03',
    'path_traversal': 'A01',  # Broken Access Control
    'idor':           'A01',
    'auth_bypass':    'A07',  # Identification and Auth Failures
    'ssrf':           'A10',  # Server-Side Request Forgery
    'missing_auth':   'A01',
    'jwt_flaw':       'A07',
    'mass_assign':    'A08',  # Software and Data Integrity Failures
}

OWASP_TOTAL_CATEGORIES = 10  # A01-A10

async def _update_coverage(
    mission_id: str,
    redis: aioredis.Redis,
    vuln_type: str
) -> float | None:
    """
    Mark an OWASP category as tested. Returns updated coverage_score or None.
    Uses Redis SETBIT for atomic category tracking.
    
    Called after Critic confirms a finding. Result is stored in state['coverage_score']
    and used by should_continue() for early-success routing.
    
    Returns None for unmapped vuln types — caller MUST check before updating state
    to avoid zeroing out the accumulated coverage score.
    """
    category = OWASP_CATEGORY_MAP.get(vuln_type)
    if not category:
        return None  # Unknown vuln type — don't update coverage
    
    # A01=bit0, A02=bit1, ..., A10=bit9
    bit_index = int(category[1:]) - 1
    await redis.setbit(f'redteam:coverage:{mission_id}', bit_index, 1)
    
    # Count set bits → coverage score
    bits_set = await redis.bitcount(f'redteam:coverage:{mission_id}')
    
    return bits_set / OWASP_TOTAL_CATEGORIES


**EventBus Interface (core/events.py):**

```python
# core/events.py — EventBus interface for WebSocket dashboard
from typing import Any, Protocol
from abc import ABC, abstractmethod

# Event type constants — single source of truth for all event types
COVERAGE_UPDATE = 'coverage_update'
COST_UPDATE = 'cost_update'
AUTH_FOUND = 'auth_credential'
STALL_WARNING = 'stall_warning'
BUDGET_WARNING = 'budget_warning'
AGENT_THOUGHT = 'agent_thought'

class WebSocketManager(Protocol):
    """
    Protocol for WebSocket connection manager.
    
    Sprint 5 implements this to provide the WebSocket broadcast layer.
    """
    
    async def broadcast_to_mission(
        self,
        mission_id: str,
        event: dict[str, Any]
    ) -> None:
        """Broadcast event to all connected clients subscribed to this mission."""
        ...

class EventBus(ABC):
    """
    Abstract event bus for real-time dashboard updates.
    
    Implementations handle WebSocket broadcast to mission-specific channels.
    Injected via build_graph() to maintain testability and DI consistency.
    """
    
    @abstractmethod
    async def publish(self, mission_id: str, event: dict[str, Any]) -> None:
        """Publish event to all connected clients for this mission."""
        ...

class WebSocketEventBus(EventBus):
    """Production WebSocket event bus implementation."""
    
    def __init__(self, websocket_manager: WebSocketManager):
        self._manager = websocket_manager
    
    async def publish(self, mission_id: str, event: dict[str, Any]) -> None:
        await self._manager.broadcast_to_mission(mission_id, event)
```

**Critic Node Integration (agents/critic_node.py):**

```python
# agents/critic_node.py — Node implementation
from core.events import COVERAGE_UPDATE

async def _evaluate_findings(
    state: RedTeamState,
    redis: aioredis.Redis,
    event_bus: EventBus,
) -> RedTeamState:
    """
    Internal: Evaluate exploit results and update coverage tracking.
    Separated from node entry point for testability.
    
    Args:
        state: Current mission state
        redis: Injected Redis client for coverage tracking
        event_bus: Injected event bus for WebSocket emissions
    """
    for result in state.get('exploit_results', []):
        verdict = deterministic_evaluate(result)
        
        if verdict.success:
            # Update coverage ONLY for known vuln types (returns None for unknown)
            new_coverage = await _update_coverage(
                state['mission_id'], redis, result.vulnerability_type
            )
            if new_coverage is not None:
                state['coverage_score'] = new_coverage
                # Emit WebSocket event for dashboard (injected event_bus, not global)
                await event_bus.publish(state['mission_id'], {
                    'type': COVERAGE_UPDATE,  # Use constant from core/events.py
                    'coverage_score': new_coverage,
                    'tested_categories': round(new_coverage * 10),
                })
    
    return state


# agents/graph.py — Graph construction with dependency injection
def build_graph(
    redis: aioredis.Redis,
    blackboard: Blackboard,
    supabase: Client,
    event_bus: EventBus,
) -> CompiledGraph:
    """
    Build LangGraph with injected infrastructure dependencies.
    All nodes receive dependencies via closure, NOT as parameters.
    """
    
    async def critic_node(state: RedTeamState) -> RedTeamState:
        """
        Critic node entry point — LangGraph calls this with state only.
        Dependencies are captured from build_graph closure.
        """
        return await _evaluate_findings(state, redis=redis, event_bus=event_bus)
    
    # Add node to graph
    graph = StateGraph(RedTeamState)
    graph.add_node('critic', critic_node)
    # ... other nodes and edges ...
    
    return graph.compile()
```

---

### Fix 7 — Stealth & Rate Control Strategy (MED)

**Root Cause:** No coordinated throttling. Also: the `yield` inside `async with` makes `acquire()` an async generator, not a context manager.

**Fix:** Unified Throttle Controller — **restructured as async context manager with per-call context to avoid concurrency races.**

```python
from dataclasses import dataclass
import asyncio
import random
from aiolimiter import AsyncLimiter  # pip install aiolimiter

class MissionThrottle:
    MODES = {
        'normal':  {'rps': 10, 'jitter_ms': 200},
        'stealth': {'rps': 2,  'jitter_ms': 2000, 'ua_rotate': True},
        'fast':    {'rps': 50, 'jitter_ms': 0},
    }

    def __init__(self, mode='normal', rng: random.Random | None = None):
        """
        Initialize throttle with mode and optional isolated RNG.
        
        Args:
            mode: 'normal', 'stealth', or 'fast'
            rng: Optional random.Random instance for deterministic replay.
                 If None, uses global random module.
        """
        self.config = self.MODES[mode]
        # AsyncLimiter enforces true RPS (leaky bucket), not just concurrency
        self._limiter = AsyncLimiter(
            max_rate=self.config['rps'],
            time_period=1.0  # per second
        )
        self._ua_list = self._load_user_agents()
        self._rng = rng or random.Random()  # Use isolated RNG if provided

    def _load_user_agents(self) -> list[str]:
        """Load rotating UA list for stealth mode."""
        from core.stealth_config import STEALTH_USER_AGENTS
        return STEALTH_USER_AGENTS

    async def acquire(self) -> '_ThrottleContext':
        """
        Acquire throttle slot, return per-call context.
        
        Usage:
            async with await throttle.acquire() as ctx:
                result = await curl_tool.execute(url=target, headers={'User-Agent': ctx.ua})
        """
        await self._limiter.acquire()
        jitter = self._rng.randint(0, self.config['jitter_ms']) / 1000
        await asyncio.sleep(jitter)
        
        ua = None
        if self.config.get('ua_rotate') and self._ua_list:
            ua = self._rng.choice(self._ua_list)
        
        return _ThrottleContext(ua=ua)


@dataclass
class _ThrottleContext:
    """
    Per-call throttle context — avoids race conditions when multiple
    concurrent tool calls share a MissionThrottle instance.
    
    Note: AsyncLimiter releases automatically on context exit via its own
    __aexit__, so we don't store or manually release it here.
    """
    ua: str | None
    
    async def __aenter__(self):
        return self  # Already acquired in MissionThrottle.acquire()
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        # AsyncLimiter handles its own release via context manager protocol
        return False
```

**Usage:**
```python
async with await throttle.acquire() as ctx:
    ua = ctx.ua  # This call's UA, not overwritten by concurrent calls
    result = await curl_tool.execute(url=target, headers={'User-Agent': ua})
```

---

## Part 2 — Phase 2 Implementation Roadmap

### 2.1 Sprint Overview (Revised)

| Sprint | Focus | Duration |
|--------|-------|----------|
| **Sprint 0** | Close all Open Questions / TODOs | Week 0 |
| Sprint 1a | Model tiers, should_continue fixes, worker merge | Weeks 1-2 |
| Sprint 1b | Auth gate with checksum, Critic hardening, throttle fix | Weeks 3-4 |
| Sprint 2 | RAG knowledge base, budget state, Auth agent | Weeks 5-8 |
| Sprint 3 | Web crawler, OSINT/CVE intel, stack fingerprinting | Weeks 9-12 |
| Sprint 4 | Coach agent, synthetic labs, vector memory, tool pipeline | Weeks 13-18 |
| Sprint 5 | Dashboard, MCP adapters, reports, plugin SDK | Weeks 19-22 |

### 2.2 Sprint 0 — Close Open Questions (Week 0)

- [ ] Implement `verify_checksum()` with HMAC specification above
- [ ] Implement `verify_vdp_scope()` with Cloudflare handling
- [ ] Define `chunk_markdown()` with all chunk strategies
- [ ] Add XSS/SSRF/path_traversal to `deterministic_evaluate()`
- [ ] Restructure `MissionThrottle` as async context manager with `_ThrottleContext`
- [ ] Define `CredentialContext` schema for Delta → Gamma token chaining
- [ ] Implement `file_tree` tool for static mode
- [ ] Implement `MissionWorkspace.write()` with async I/O
- [ ] Generate and document Fernet key for CredentialVault (see Appendix B)

### 2.3 Sprint 1a — Critical Fixes Part A (Weeks 1-2)

- [ ] Resolve Fix 1 (Model tiers) — add startup assertion
- [ ] Resolve Fix 2 (should_continue) — deterministic stall detection with proper wiring
- [ ] Resolve Fix 5 (Worker scripts) — merge and delete _new
- [ ] Zero regressions on existing test suite

### 2.4 Sprint 1b — Critical Fixes Part B (Weeks 3-4)

- [ ] Deploy AuthorizationContext schema to Supabase
- [ ] Implement preflight_authorization with HMAC checksum
- [ ] Implement MissionThrottle as async context manager
- [ ] Harden Critic with XSS/SSRF/path_traversal checks
- [ ] Authorization bypass safety test passes
- [ ] Scope enforcement safety test passes
- [ ] Checksum tampering safety test passes
- [ ] HITL bypass safety test passes

### 2.5 Sprint 2 — Core Foundation (Weeks 5-8)

#### Feature 2.1 — Hacking Knowledge RAG

> **CRITICAL FIX:** Replace `all-MiniLM-L6-v2` with `BAAI/bge-base-en-v1.5` or `jinaai/jina-embeddings-v2-base-en`. MiniLM conflates semantically similar security concepts.

**Embedding Model:**
```python
# core/rag_store.py
from sentence_transformers import SentenceTransformer

class HackingKnowledgeRAG:
    def __init__(self, qdrant_url, collection='hack_docs'):
        self.client = QdrantClient(qdrant_url)
        # SECURITY-SPECIFIC EMBEDDING MODEL
        self.encoder = SentenceTransformer('BAAI/bge-base-en-v1.5')
```

**Knowledge Sources (Priority Order):**

| Priority | Source | Chunk Strategy | agent_roles |
|----------|--------|----------------|-------------|
| 1 | PayloadsAllTheThings | By H2 heading | gamma, alpha |
| 2 | Nuclei Templates | YAML frontmatter | alpha, critic |
| 3 | CISA KEV | JSON object per CVE | intel |
| 4 | NVD API | JSON object per CVE | intel |
| 5 | HackTricks | By H2, filter install sections | all |
| 6 | MITRE ATT&CK | STIX technique | gamma (post-exploit) |
| 7 | Exploit-DB CSV | Full document | intel |
| 8 | PortSwigger WSA | By topic page | critic, gamma |
| 9 | HackerOne Reports | Full document | coach |
| 10 | GTFOBins + LOLBAS | YAML/JSON lookup | gamma (post-exploit) |

**Chunk Strategy Implementation:**
```python
CHUNK_STRATEGIES = {
    'payloads_all_things': chunk_by_h2_heading,
    'hacktricks': chunk_by_h2_with_filter,
    'nuclei_template': chunk_yaml_frontmatter,
    'nvd_cve': chunk_json_object,
    'cisa_kev': chunk_json_object,
    'h1_report': chunk_full_document,
    'attack_technique': chunk_stix_technique,
}

def chunk_by_h2_heading(content: str, max_tokens: int = 512) -> list[Chunk]:
    """Split by ## headings, each becomes a self-contained technique."""
    sections = re.split(r'^##\s+', content, flags=re.MULTILINE)
    chunks = []
    for section in sections:
        if not section.strip():
            continue
        chunks.append(Chunk(
            text=section.strip(),
            tokens=count_tokens(section),
            tags=extract_tags_from_section(section)
        ))
    return chunks
```

#### Feature 2.2 — Auth Agent (Delta)

**CredentialContext Schema (`agents/schemas.py`):**
```python
from pydantic import SecretStr

class CredentialContext(BaseModel):
    """Typed credential for Gamma consumption."""
    token: SecretStr                    # Pydantic SecretStr — redact in logs/display
    token_handle: str                   # Opaque reference stored in state
    type: Literal['bearer', 'cookie', 'api_key', 'basic_auth', 'jwt', 'session']
    scope: list[str]                   # URLs/paths where this credential is valid
    discovered_at: str                  # ISO timestamp
    discovered_by: str                  # 'delta_auth'
    expiry: str | None                 # ISO timestamp if known
    metadata: dict[str, Any]          # Additional context (e.g., cookie flags)

class DiscoveredCredentials(BaseModel):
    """Container for all credentials found by Delta."""
    credentials: list[CredentialContext]
    default_credential: str | None      # Preferred credential handle for Gamma
```

**Token Propagation:**
```python
# Delta writes typed credentials (token is SecretStr — will be masked in logs)
await blackboard.set('discovered_credentials', credentials.model_dump())

# Gamma reads typed credentials
creds = DiscoveredCredentials(**blackboard.get('discovered_credentials', {}))
for cred in creds.credentials:
    if target_url in cred.scope:
        # NOTE: Must use .get_secret_value() to extract actual token from SecretStr
        headers['Authorization'] = f"Bearer {cred.token.get_secret_value()}"
```

#### Feature 2.3 — Mission-Local Workspace

```python
import asyncio
from pathlib import Path
import shutil

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

    async def write(self, filename: str, content: str | bytes) -> None:
        """
        Write content to a file within the workspace.
        Uses run_in_executor to avoid blocking the event loop on large files.
        """
        path = self.root / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        
        loop = asyncio.get_running_loop()
        if isinstance(content, bytes):
            await loop.run_in_executor(None, path.write_bytes, content)
        else:
            await loop.run_in_executor(None, path.write_text, content, 'utf-8')

    async def read(self, filename: str) -> str:
        """Read content from a file within the workspace."""
        path = self.root / filename
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, path.read_text, 'utf-8')

    async def cleanup(self, keep_reports=True):
        shutil.rmtree(self.scripts, ignore_errors=True)
        shutil.rmtree(self.lists, ignore_errors=True)

    def path(self, *parts) -> str:
        """Return absolute path within workspace for sandbox exec."""
        return str(self.root.joinpath(*parts))
```

Add `workspace_path: str` to RedTeamState.

### 2.6 Sprint 3 — Intelligence & Targeting (Weeks 9-12)

#### Feature 3.1 — Web Crawling Agent

> **CRITICAL FIX:** Add anti-detection measures. Playwright without stealth is fingerprinted and blocked by Cloudflare/PerimeterX.

**Crawler Agent Specification:**
```python
import random
from core.stealth_config import STEALTH_USER_AGENTS

class CrawlerAgent:
    def __init__(self, rng: random.Random | None = None):
        """
        Initialize crawler with optional isolated RNG for deterministic replay.
        
        Args:
            rng: Optional random.Random instance for deterministic UA selection.
                 If None, uses global random module.
        """
        self._rng = rng or random.Random()
    
    async def crawl(self, target: str, depth: int = 3) -> SiteMap:
        stealth_context = await self._create_stealth_context()
        
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            try:
                context = await browser.new_context(**stealth_context)
                page = await context.new_page()
                
                # Block telemetry/analytics
                await page.route('**/*.{analytics,telemetry}*', lambda r: r.abort())
                
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
            finally:
                # Ensure browser process is always closed (prevents leaks on exception)
                await browser.close()

    async def _create_stealth_context(self) -> dict:
        """Apply playwright-stealth patches and rotating UA."""
        return {
            'user_agent': self._rng.choice(STEALTH_USER_AGENTS),
            'viewport': {'width': 1920, 'height': 1080},
            'locale': 'en-US',
            'timezone_id': 'America/New_York',
            'permissions': ['geolocation'],
            'ignore_https_errors': True,
        }
```

**Stealth Configuration (core/stealth_config.py):**

```python
# core/stealth_config.py — Single source of truth for stealth configuration
# Shared between MissionThrottle (rate limiting) and CrawlerAgent (browser automation)

STEALTH_USER_AGENTS: list[str] = [
    # Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    # Chrome on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    # Safari on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    # Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    # Firefox on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
    # Edge on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    # Chrome on Linux
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    # Firefox on Linux
    'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0',
]

# Runtime warning if fewer than 20 UAs — use warnings.warn so the module still imports
import warnings
if len(STEALTH_USER_AGENTS) < 20:
    warnings.warn(
        f"Only {len(STEALTH_USER_AGENTS)} UAs defined — stealth rotation degraded. "
        "Add at least 20 for effective anti-fingerprinting.",
        stacklevel=2
    )
```

> **Note:** Both `MissionThrottle` (Part 3.4) and `CrawlerAgent` (Feature 3.1) import from this shared module. This ensures consistent UA rotation across all stealth operations.

#### Feature 3.2 — Dynamic API Discovery

```python
async def discover_api_endpoints(
    target: str,
    workspace: MissionWorkspace,
    blackboard: Blackboard  # Injected, not global
):
    """
    Discover API endpoints from JS bundles.
    
    Args:
        target: Target URL to scan
        workspace: Mission-local workspace for file output
        blackboard: Injected blackboard for state storage
    """
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

> **Implementation Note:** See **Part 3.4 — Dependency Injection Pattern** for the canonical `IntelAgent` class implementation with proper DI. The class form is preferred over the standalone function for testability and consistency with the rest of the codebase.

**IntelAgent Interface:**
```python
class IntelAgent:
    """
    Intel agent — queries CISA KEV, NVD, Exploit-DB for stack vulnerabilities.
    
    See Part 3.4 for full implementation with dependency injection.
    """
    
    def __init__(self, redis: aioredis.Redis, blackboard: Blackboard):
        self._redis = redis
        self._blackboard = blackboard
    
    async def run(self, state: RedTeamState) -> RedTeamState:
        """Execute intel gathering and update state."""
        stack = self._blackboard.get('stack_fingerprint', {})
        findings = []
        
        for component, version in stack.items():
            kev_results = await cisa_kev_search(f'{component} {version}')
            cves = await nvd_search(f'{component} {version}')
            exploits = await exploitdb_search(component, version)
            
            for cve in cves[:3]:
                poc = await synthesize_poc(cve, component, version)
                findings.append(IntelFinding(
                    cve_id=cve.id, component=component,
                    cvss=cve.cvss_score, poc=poc,
                    in_kev=any(k.id == cve.id for k in kev_results),
                    exploit_db_url=exploits[0].url if exploits else None
                ))
        
        await self._blackboard.set('cve_intel', [
            f.dict() for f in sorted(findings, key=lambda x: x.cvss, reverse=True)
        ])
        return state
```

### 2.7 Sprint 4 — Self-Improvement Loop (Weeks 13-18)

#### Feature 4.1 — Coach Agent

| Component | Description |
|-----------|-------------|
| Training Targets | Juice Shop, DVWA, WebGoat (docker-compose) |
| Mission Runner | 10 training missions per target with logging |
| **Mission Replay** | Deterministic rerun with seed for pre/post patch comparison |
| Failure Analysis | Coach LLM analyzes missed vulns + root cause |
| Prompt Rewriting | Coach proposes prompt patches as diffs |
| HITL Gate | Human approves patches before commit |
| Regression Testing | Re-run missions to verify improvement |

**Mission Replay (deterministic seed):**
```python
class RedTeamState(TypedDict):
    # ... existing fields ...
    replay_seed: int | None  # Seed for deterministic rerun

def _get_deterministic_throttle(mode: str, seed: int) -> MissionThrottle:
    """
    Create throttle with seeded randomness for reproducible runs.
    Uses isolated random.Random instance to avoid global state interference.
    """
    rng = random.Random(seed)  # Isolated instance, not global
    throttle = MissionThrottle(mode, rng=rng)
    return throttle
```

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
```python
TOOL_GENERATION_PIPELINE = [
    'generate_code',           # LLM writes tool
    'bandit_analysis',         # Bandit B413 (blacklist) checks
    'semgrep_analysis',        # semgrep --config=python.lang.security
    'custom_rules',            # Block: subprocess, os.system, socket.connect
    'hitl_review',             # Human approval
    'sandbox_test',            # Execute in network-isolated sandbox
    'register',                # Add to ToolRegistry
]

FORBIDDEN_PATTERNS = [
    r'import\s+subprocess',
    r'os\.system\(',
    r'os\.popen\(',
    r'socket\.connect\(',
    r'urllib\.request\.urlopen',
    r'requests\.post\(.*timeout\s*=\s*None',
    r'\beval\s*\(',          # Dynamic eval
    r'\bexec\s*\(',          # Dynamic exec
    r'__import__\s*\(',      # Dynamic import
    r'compile\s*\(',         # Code compilation
    r'ctypes\.',             # C-level access
    r'importlib\.import_module',  # Dynamic import via importlib
]
# NOTE: This list is defense-in-depth, not a primary control.
# The authoritative safety gate is Bandit + semgrep + HITL review.
# This list blocks obvious cases to fail fast, but is not exhaustive
# (eval, exec, __import__, ctypes, etc. can always bypass).
```

---

### 2.8 Sprint 5 — Platform & Ecosystem (Weeks 19-22)

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
BUDGET_WARNING  = 'budget_warning'   # {'cost_pct': 0.85}
AUTH_FOUND      = 'auth_credential'   # {'type': 'jwt', 'handle': '...'}  # NO plaintext
```

#### Feature 5.2 — MCP Tool Adapters

```python
class SwarmMCPBridge:
    async def register_mcp_server(self, server_url: str, server_name: str):
        adapter = MCPToolAdapter(server_url=server_url)
        tools = await adapter.list_tools()
        for mcp_tool in tools:
            # Capture tool name at lambda creation time via default argument
            wrapped = ToolSpec(
                name=f'mcp_{server_name}_{mcp_tool.name}',
                description=mcp_tool.description,
                args_schema=mcp_tool.input_schema,
                execute=lambda _tool=mcp_tool.name, **kw: adapter.call(_tool, **kw),
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
    missions: dict[str, str]
    shared_intel: dict[str, Any]
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
    authorized_by   TEXT NOT NULL,  -- Stores auth.email() or auth.uid()::text
    authorized_at   TIMESTAMPTZ NOT NULL,
    expiry          TIMESTAMPTZ,
    checksum        TEXT NOT NULL,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on swarm_authorizations
ALTER TABLE swarm_authorizations ENABLE ROW LEVEL SECURITY;

-- RLS: Use auth.email() for authenticated user, not current_user()
CREATE POLICY "Users view own authorizations" ON swarm_authorizations
    FOR SELECT USING (authorized_by = auth.email());

CREATE POLICY "Users insert own authorizations" ON swarm_authorizations
    FOR INSERT WITH CHECK (authorized_by = auth.email());

CREATE POLICY "Users update own authorizations" ON swarm_authorizations
    FOR UPDATE USING (authorized_by = auth.email());

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

-- CRITICAL: Add indexes for cost queries
CREATE INDEX idx_cost_ledger_mission ON swarm_cost_ledger(mission_id);
CREATE INDEX idx_cost_ledger_created ON swarm_cost_ledger(created_at DESC);

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

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `redteam:throttle:{mission_id}` | Mission throttle token bucket state | Mission lifetime |
| `redteam:workspace:{mission_id}` | Workspace path and file manifest | Mission lifetime |
| `redteam:cost:{mission_id}` | **Single source of truth for budget enforcement** | Mission lifetime |
| `redteam:coverage:{mission_id}` | OWASP category bitmask (SETBIT) | Mission lifetime |
| `redteam:auth:{mission_id}:verified` | Authorization verified flag | Mission lifetime |
| `campaign:{campaign_id}:shared_intel` | Cross-target shared intelligence | Campaign lifetime |

> **CRITICAL:** `redteam:cost:{mission_id}` is the **single source of truth** for budget enforcement. Supabase `swarm_cost_ledger` is async/audit only — never used for enforcement decisions.

**Atomic Cost Recording (core/redis_bus.py):**
```python
import aioredis
import asyncio
from typing import Set

# Track background tasks to prevent premature GC/cancellation
_background_tasks: Set[asyncio.Task] = set()

async def record_llm_cost(
    redis: aioredis.Redis,
    supabase: Client,
    mission_id: str,
    cost_usd: float,
    max_cost_usd: float
) -> bool:
    """
    Atomically record LLM cost using INCRBYFLOAT.
    Returns True if budget exceeded.
    
    INCRBYFLOAT is atomic at Redis level — no read-then-write race conditions.
    Background task tracking prevents audit writes from being cancelled
    if the event loop shuts down before they complete.
    
    Args:
        redis: Injected aioredis.Redis client
        supabase: Injected Supabase client for audit logging
    """
    new_total = float(await redis.incrbyfloat(
        f'redteam:cost:{mission_id}', cost_usd
    ))
    
    # Fire-and-forget async write to Supabase for audit (non-blocking)
    # Track task to prevent cancellation before completion
    task = asyncio.create_task(_write_cost_ledger(supabase, mission_id, cost_usd))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)  # Auto-cleanup on completion
    
    return new_total >= max_cost_usd

async def _write_cost_ledger(supabase: Client, mission_id: str, cost_usd: float):
    """
    Async write to Supabase for audit — failures are logged, not raised.
    
    Args:
        supabase: Injected Supabase client (NOT a global)
    """
    try:
        # Insert into swarm_cost_ledger via Supabase client
        await supabase.table('swarm_cost_ledger').insert({
            'mission_id': mission_id,
            'cost_usd': cost_usd,
        })
    except Exception as e:
        logger.warning(f'Failed to write cost ledger for {mission_id}: {e}')
```

### 3.3 Qdrant Collections

| Collection | Purpose |
|------------|---------|
| `hack_docs` | Hacking knowledge RAG |
| `mission_learnings` | Per-stack exploit strategy memory |
| `playbooks` | YAML playbook embeddings |
| `stack_fingerprints` | Tech stack embeddings for similarity search |

### 3.4 Dependency Injection Pattern

**Problem:** Global `redis_client` and `blackboard` references create tight coupling and make testing difficult.

**Solution:** Inject infrastructure dependencies via constructors and closures.

```python
import aioredis

class CredentialVault:
    def __init__(self, redis: aioredis.Redis, fernet_key: str | None = None):
        self._redis = redis  # Injected, not global
        if fernet_key is None:
            fernet_key = os.environ['CREDENTIAL_VAULT_KEY']
        self._fernet = Fernet(fernet_key.encode())

class IntelAgent:
    def __init__(self, redis: aioredis.Redis, blackboard: Blackboard):
        self._redis = redis
        self._blackboard = blackboard

# Graph construction with dependency injection:
def build_graph(
    redis: aioredis.Redis,
    blackboard: Blackboard,
    supabase: Client,
    event_bus: EventBus,
) -> CompiledGraph:
    """
    Build LangGraph with injected infrastructure.
    
    This pattern enables:
    - Unit testing with mock Redis/blackboard/supabase/event_bus
    - Multiple concurrent missions with isolated state
    - No global state pollution
    
    All infrastructure dependencies are injected here and captured in closures.
    """
    vault = CredentialVault(redis=redis)
    
    async def delta_auth_node(state: RedTeamState):
        # vault captured from closure, not imported global
        creds = await vault.list_credentials(state['mission_id'])
        ...
    
    async def intel_node(state: RedTeamState):
        agent = IntelAgent(redis=redis, blackboard=blackboard)
        return await agent.run(state)
    
    async def critic_node(state: RedTeamState) -> RedTeamState:
        """Critic node with event_bus and redis injected via closure."""
        return await _evaluate_findings(state, redis=redis, event_bus=event_bus)
    
    # Build and return compiled graph
    graph = StateGraph(RedTeamState)
    graph.add_node('delta_auth', delta_auth_node)
    graph.add_node('intel', intel_node)
    graph.add_node('critic', critic_node)
    ...
    return graph.compile()
```

**Testing with injected mocks:**
```python
async def test_credential_vault():
    # No need to patch global redis_client
    mock_redis = MockRedis()
    vault = CredentialVault(redis=mock_redis, fernet_key='test-key')
    
    handle = vault.store('mission-123', test_cred)
    retrieved = vault.retrieve('mission-123', handle)
    
    assert retrieved.token.get_secret_value() == 'secret-token'
```

---

## Part 4 — Testing Strategy

### 4.1 Testing by Sprint

| Sprint | Test Requirements |
|--------|------------------|
| Sprint 0 | All TODO implementations tested in isolation |
| Sprint 1a | Model tier assertion passes; stall detection deterministic; worker merge zero regressions |
| Sprint 1b | Auth gate passes all safety tests; throttle async context manager works; Critic XSS/SSRF/PT checks |
| Sprint 2 | RAG precision@5 > 0.7 (requires ground truth dataset); Auth agent unit tests; Workspace isolation test |
| Sprint 3 | Crawler anti-detection against Cloudflare; API discovery on Juice Shop; CVE lookup rate limiting |
| Sprint 4 | Coach diff = valid Python; Engineer tools pass Bandit + semgrep; Mission replay produces identical runs |
| Sprint 5 | WebSocket events complete; Report templates pass schema; Campaign intel isolation |

### 4.2 Mandatory Safety Tests (Every Sprint)

| Test | Expected Behavior |
|------|------------------|
| Authorization bypass | No auth context → raise + log, never execute |
| Scope enforcement | Target outside scope → reject at preflight |
| **Checksum tampering** | Valid auth copied + scope_domains mutated + checksum NOT updated → **must reject** |
| Excluded domains | Target in excluded_domains → reject at preflight |
| Expired auth | Auth with past expiry → reject at preflight |
| HITL bypass | Destructive pattern → pause for approval, never auto-execute |
| Budget enforcement | max_cost_usd=0.001 → terminate after first LLM call |
| Workspace isolation | Concurrent missions → separate directories, no collisions |
| Engineer tool safety | os.system() in generated tool → rejected by Bandit + semgrep |

### 4.3 RAG Precision Ground Truth Dataset

> **The "precision@5 > 0.7" target is unmeasurable without a labeled eval set.**

Build before Sprint 2 ends:

```python
RAG_EVAL_QUERIES = [
    {
        'query': 'JWT algorithm confusion bypass technique',
        'expected_docs': ['JWT algorithm confusion', 'HS256 vs RS256'],
        'category': 'auth_bypass'
    },
    {
        'query': 'blind SQL injection time-based detection',
        'expected_docs': ['SQLi time-based', 'sleep() injection'],
        'category': 'sqli'
    },
    # ... 20-30 more labeled queries
]

async def evaluate_rag_precision(rag: HackingKnowledgeRAG, eval_queries: list) -> float:
    """
    Measure precision@5 against ground truth.
    Must be async since rag.retrieve() is awaitable.
    """
    hits = 0
    for query in eval_queries:
        results = await rag.retrieve(query['query'], agent_role='gamma', limit=5)
        for doc in results:
            if any(exp in doc.content for exp in query['expected_docs']):
                hits += 1
                break
    return hits / len(eval_queries)
```

---

## Part 5 — Dependency Graph & Rollout Sequence

### 5.1 Feature Dependencies (Updated)

| Feature | Unblocks | Blocked By |
|---------|----------|------------|
| Sprint 0 TODOs | Everything | — |
| Fix 1: Model tiers | Sprint 1a | — |
| Fix 2: should_continue() | Sprint 1a | — |
| Fix 5: Worker merge | Sprint 1a | — |
| Fix 3: Auth gate + checksum | Live missions, MCP, Campaign | Sprint 0 |
| Fix 6: Critic hardening | Coach accuracy, mission learning | Sprint 0 |
| Fix 7: Throttle fix | All tool execution | Sprint 0 |
| RAG store (2.1) | Per-agent doc injection; Coach; Playbooks | Sprint 0 |
| Mission workspace (2.3) | Engineer tool output; Crawler; API storage | — |
| Auth agent (2.2) | Token chaining; Two-phase exploit precision | Sprint 0 |
| Crawler agent (3.1) | API discovery; OWASP classification | Sprint 0 |
| Intel agent (3.3) | CVE-driven Gamma selection; PoC synthesis | — |
| Coach + labs (4.1) | Prompt improvement; Refiner baseline | Fix 6, RAG store |
| Vector memory (4.2) | Stack strategy recall; Campaign intel | RAG store |
| Engineer agent (4.3) | Custom tools; Plugin SDK | Fix 7 (throttle) |
| Dashboard (5.1) | Cost visibility; Coverage; Stakeholder reporting | Fix 3 (budget) |

### 5.2 Recommended Rollout

| Weeks | Sprint | Work |
|-------|--------|------|
| 0 | **Sprint 0** | Close all Open Questions |
| 1-2 | 1a | Model tiers, should_continue deterministic, worker merge |
| 3-4 | 1b | Auth gate with HMAC, Critic XSS/SSRF/PT, throttle fix |
| 5-6 | 2 | RAG ingestion + Mission workspace |
| 7-8 | 2 | Budget state + Auth agent + CredentialContext |
| 9-10 | 3 | Crawler (with anti-detection) + API discovery |
| 11-12 | 3 | Intel agent + Stack fingerprinting |
| 13-16 | 4 | Coach + Synthetic labs |
| 17-18 | 4 | Vector memory + Playbooks + Engineer agent |
| 19-20 | 5 | Dashboard + MCP adapters |
| 21-22 | 5 | Reports, campaign mode, plugin SDK |

---

## Part 6 — Summary & Key Decisions

### 6.1 Change Summary

| Category | Count |
|----------|-------|
| Critical bug fixes | 7 |
| New agent types | 5 (Delta Auth, Beta Crawler, Intel, Coach, Engineer) |
| New core modules | 6 (RAG, Throttle, Workspace, MCP Adapter, Memory, Report Optimizer) |
| State schema additions | 14 fields (+2 for deterministic stall) |
| New Supabase tables | 4 (+ RLS policies) |
| New Supabase indexes | 2 (cost_ledger) |
| New Redis key patterns | 6 |
| New Qdrant collections | 4 |
| New API endpoints | 8 |
| New WebSocket events | 6 |
| Total development weeks | 23 (includes Sprint 0) |

### 6.2 Key Architectural Decisions

1. **Authorization is a hard gate, not a flag** — Enforced as first graph node with HMAC-verified checksum. Cannot be bypassed.

2. **Model tiers are non-negotiable** — Commander uses reasoning-class models. Code models only for Gamma. Enforced by startup assertions.

3. **Engineer agent has mandatory HITL gate + semgrep** — No auto-registration. Every tool requires human review + Bandit + semgrep.

4. **Budget/time signals replace iteration counting** — Redis is single source of truth for enforcement. Supabase ledger is async/audit only.

5. **Stall detection is deterministic** — Computed in graph layer by comparing findings hashes. Activates from iteration 2 onward.

6. **Workspace isolation is first-class** — Every mission gets isolated filesystem namespace from start.

7. **Crawl with anti-detection** — Playwright stealth patches + rotating UA required for beta_crawl to function on real targets.

---

## Appendix A — RAG Knowledge Sources

> **⚠️ EMBEDDING MIGRATION WARNING:** 
> `BAAI/bge-base-en-v1.5` produces 768-dimensional embeddings; `all-MiniLM-L6-v2` produces 384-dimensional embeddings. These are **incompatible** — do not incrementally add to an existing MiniLM-indexed collection. If `hack_docs` was previously indexed with MiniLM, you must **drop and recreate** the collection before reinserting.
> 
> ```python
> # Migration command:
> qdrant_client.delete_collection('hack_docs')
> # Then reingest from scratch with bge-base-en-v1.5
> ```

### Tier 1 — Ingest First (High Signal, Machine-Friendly)

| Source | URL | Format | Chunk Strategy | Priority |
|--------|-----|--------|----------------|----------|
| PayloadsAllTheThings | GitHub: m3 payloadsallthethings | Markdown | By H2 heading | 1 |
| Nuclei Templates | GitHub: projectdiscovery/nuclei-templates | YAML | Frontmatter | 2 |
| CISA KEV | cisa.gov/KEV | JSON | JSON object | 3 |
| NVD CVE API | nvd.nist.gov/developers/vulnerabilities | JSON | JSON object | 4 |

### Tier 2 — High Value, Requires Processing

| Source | URL | Format | Chunk Strategy | agent_roles |
|--------|-----|--------|----------------|-------------|
| HackTricks | book.hacktricks.xyz | Markdown | By H2, filter install | all |
| Exploit-DB CSV | GitHub: offensive-security/exploitdb | CSV | Full row | intel |
| PortSwigger WSA | web-securityacademy | HTML | By topic | critic, gamma |
| MITRE ATT&CK | attack.mitre.org | STIX 2.1 | By technique | gamma (post) |

### Tier 3 — Specialized / High Effort

| Source | URL | Format | Use Case |
|--------|-----|--------|----------|
| HackerOne Reports | Community dataset | JSON | Coach training |
| GTFOBins | GitHub: nccgroup/GTFOBins | YAML/JSON | Post-exploit |
| LOLBAS | lolbas-project.github.io | JSON | Post-exploit |
| SecLists | GitHub: danielmiessler/SecLists | Wordlists | Feed wordlists, not RAG |

### Priority Ingestion Order

1. PayloadsAllTheThings — directly maps to Gamma arsenal
2. Nuclei Templates — executable detection patterns
3. CISA KEV — real-world exploitation signal
4. NVD API — CVE→CVSS→component
5. HackTricks — broadest coverage
6. MITRE ATT&CK — post-exploitation
7. Exploit-DB CSV — PoC availability
8. PortSwigger WSA — clean technique docs
9. HackerOne Reports — Coach training
10. GTFOBins + LOLBAS — privilege escalation

---

## Appendix B — Credential Vault Design

**Problem:** `discovered_credentials` in plaintext in Redis/Supabase means credentials appear in logs, state dumps, and audit tables.

**Solution:** Opaque handle pattern with Fernet encryption.

**Key Generation (deploy-time):**

```python
from cryptography.fernet import Fernet

# Generate a valid Fernet key at deploy time:
# $ python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Store the output as CREDENTIAL_VAULT_KEY environment variable.
# The key is a URL-safe base64-encoded 32-byte key with built-in signing.
```

**Vault Implementation:**

```python
from cryptography.fernet import Fernet
import base64
import json
import secrets

class CredentialVault:
    """
    Stores credentials encrypted in Redis with short TTL.
    State/logs only contain opaque handles, never plaintext credentials.
    
    Uses Fernet (AES-128-CBC with HMAC) for authenticated encryption.
    
    Key generation:
        from cryptography.fernet import Fernet
        print(Fernet.generate_key().decode())  # Use output as CREDENTIAL_VAULT_KEY
    
    IMPORTANT: Pass the raw Fernet key string to __init__, not a re-encoded version.
    The key IS the Fernet key (already URL-safe base64-encoded 32 bytes).
    """
    
    VAULT_PREFIX = 'vault:credential:'
    DEFAULT_TTL = 3600  # 1 hour
    
    def __init__(self, redis: aioredis.Redis, fernet_key: str | None = None):
        """
        Initialize vault with injected Redis client and Fernet key.
        
        Args:
            redis: Injected aioredis.Redis client (NOT a global)
            fernet_key: A valid Fernet key string (from Fernet.generate_key()).
                       Falls back to CREDENTIAL_VAULT_KEY env var if not provided.
        """
        self._redis = redis  # Injected, not global
        if fernet_key is None:
            fernet_key = os.environ['CREDENTIAL_VAULT_KEY']
        # Fernet expects bytes, Fernet key is already URL-safe base64 encoded
        self._fernet = Fernet(fernet_key.encode())
    
    async def store(self, mission_id: str, cred: CredentialContext) -> str:
        """
        Store credential, return opaque handle.
        Credential is encrypted with Fernet before Redis storage.
        """
        import json
        
        handle = secrets.token_urlsafe(16)
        key = f'{self.VAULT_PREFIX}{mission_id}:{handle}'
        
        # Extract secret value before serialization — SecretStr masks in model_dump_json()
        data = cred.model_dump(mode='json')
        data['token'] = cred.token.get_secret_value()  # Explicitly extract secret
        plaintext = json.dumps(data)
        
        # Encrypt credential JSON with Fernet (handles nonce + HMAC)
        ciphertext = self._fernet.encrypt(plaintext.encode())
        
        await self._redis.setex(key, self.DEFAULT_TTL, ciphertext)
        return handle
    
    async def retrieve(self, mission_id: str, handle: str) -> CredentialContext | None:
        """
        Retrieve credential by handle.
        Returns None if handle not found or decryption fails.
        """
        key = f'{self.VAULT_PREFIX}{mission_id}:{handle}'
        ciphertext = await self._redis.get(key)
        
        if not ciphertext:
            return None
        
        try:
            plaintext = self._fernet.decrypt(ciphertext)
            return CredentialContext.model_validate_json(plaintext)
        except Exception:
            # Decryption failure — handle is invalid or tampered
            return None
    
    async def revoke(self, mission_id: str, handle: str) -> bool:
        """Revoke a credential handle immediately."""
        key = f'{self.VAULT_PREFIX}{mission_id}:{handle}'
        return await self._redis.delete(key) > 0
```

**State Storage (only handle, never plaintext):**
```python
class RedTeamState(TypedDict):
    # ...
    credential_handles: list[str]  # Opaque handles only
```

---

## Open Questions / TODO (CLOSED in Sprint 0)

| # | Item | Resolution | Status |
|---|------|------------|--------|
| 1 | `verify_checksum()` | `hmac.digest()` with server-side secret | Sprint 0 |
| 2 | `verify_vdp_scope()` | Fetch + parse VDP policy page | Sprint 0 |
| 3 | `chunk_markdown()` | Multi-strategy with H2, YAML, JSON, STIX | Sprint 0 |
| 4 | XSS/SSRF/PathTrav in Critic | Added with encoded-payload check + CSP vectors | Sprint 0 |
| 5 | Restructure MissionThrottle | Async context manager + `_ThrottleContext` for concurrency safety | Sprint 0 |
| 6 | `CredentialContext` schema | Typed schema with token/type/scope/expiry | Sprint 0 |
| 7 | `file_tree` tool | Implementation deferred to Fix 4 | Sprint 0 |
| 8 | RAG embedding model | Replace MiniLM with bge-base-en-v1.5 | Sprint 0 |
| 9 | Blackboard versioning | Optimistic locking with version counter | Sprint 2 |
| 10 | Mission replay seed | replay_seed field + isolated random.Random instance | Sprint 4 |
| 11 | `MissionWorkspace.write()` | Added with `run_in_executor` for async I/O | Sprint 0 |
| 12 | MCP lambda closure | Default argument capture for tool name | Sprint 0 |
| 13 | RLS policy `current_user()` | Use `auth.email()` instead | Sprint 0 |
| 14 | Fernet key handling | Generate with `Fernet.generate_key()`, use directly | Sprint 0 |
| 15 | Throttle concurrent mission race | Return `_ThrottleContext` per `__aenter__` call | Sprint 0 |
| 16 | RAG eval `await` in sync func | Made `evaluate_rag_precision` async | Sprint 0 |
| 17 | Fix hmac.new() comment | Corrected — hmac.new() exists, hmac.digest() is one-shot form | Sprint 0 |
| 18 | Replace Semaphore with AsyncLimiter | True RPS limiting (leaky bucket) not concurrency limit | Sprint 0 |
| 19 | INCRBYFLOAT atomic cost increments | Atomic budget tracking, no read-then-write race | Sprint 1b |
| 20 | Inject redis/blackboard via constructor | Dependency injection for testability | Sprint 2 |
| 21 | Full verify_vdp_scope() spec | httpx + BeautifulSoup with Cloudflare handling | Sprint 0 |
| 22 | _update_coverage() with OWASP bitmask | Redis SETBIT for atomic category tracking | Sprint 1b |
| 23 | RAG collection migration note | Drop-and-reingest warning for embedding dim change | Sprint 2 |
| 24 | Document stall hash scope | Exploit-only is intentional design decision | Sprint 0 |
