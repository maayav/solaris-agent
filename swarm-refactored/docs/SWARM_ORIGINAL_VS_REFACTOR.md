# Swarm Module: Original Python vs TypeScript Refactor Comparison

## Overview

| Aspect | Original Python (`swarm module/`) | TypeScript Refactor (`swarm-refactored/`) |
|--------|-----------------------------------|----------------------------------------|
| Language | Python | TypeScript |
| Architecture | LangGraph-based | State machine / LangGraph-like |
| Models | Ollama (exploit + critic models) | Ollama (exploit + critic models) |
| Storage | Redis + Supabase | Redis + Supabase |
| Testing | pytest | Vitest |

---

## Feature Comparison

### 1. Gamma Exploit Agent

| Feature | Original Python | TypeScript | Status |
|---------|---------------|-----------|--------|
| LLM-generated exploits | ✓ | ✓ | Complete |
| Juice Shop hardcoded exploits | ~20 always merged | 23 exploits (toggle-controlled) | **Restored** |
| Fallback arsenal | ~20 on LLM failure | 20 exploits (toggle-controlled) | **Restored** |
| Hardcoded exploits toggle | N/A | `use_hardcoded_exploits` flag (default: false) | **Complete** |
| Variant generation | Up to 8 per success type | Capped at 15 total | Partial |
| IDOR variants | 12+ IDs per endpoint | Limited (5-12 IDs) | **Needs improvement** |
| Token extraction | `extract_session_tokens()` | `extractSessionTokens()` | Complete |
| Token injection | Redis-based shared tokens | Redis-based shared tokens | Complete |
| Self-reflection loop | `_self_reflect_and_retry()` | ❌ Missing | **Gap** |
| Critic model | Full LLM-based evaluation | `analyze_exploit_result()` | Partial |

### 2. Reconnaissance

| Feature | Original Python | TypeScript | Status |
|---------|---------------|-----------|--------|
| Alpha Recon agent | ✓ | ✓ | Complete |
| Endpoint discovery | ✓ | ✓ | Complete |
| Nmap integration | ✓ | ✓ | Complete |
| Recon → Exploit flow | ✓ | ✓ | Complete |
| Dynamic fuzzing from recon | ❌ | ❌ | **Gap** |

### 3. Commander Agent

| Feature | Original Python | TypeScript | Status |
|---------|---------------|-----------|--------|
| Task assignment | ✓ | ✓ | Complete |
| Mission orchestration | ✓ | ✓ | Complete |
| Blackboard | Redis-based | Redis-based | Complete |

### 4. Critic Agent

| Feature | Original Python | TypeScript | Status |
|---------|---------------|-----------|--------|
| LLM-based evaluation | ✓ Full critic model | ✓ Uses exploit model | Partial |
| Error pattern detection | 8+ patterns | 8 patterns | Complete |
| Success criteria | Detailed per vuln type | Detailed per vuln type | Complete |
| Token extraction | ✓ | ✓ | Complete |
| Severity assignment | ✓ | ✓ | Complete |
| Self-reflection guidance | ✓ | ❌ | **Gap** |
| Juice Shop hints | ✓ | ✓ | Complete |

### 5. Storage & Persistence

| Feature | Original Python | TypeScript | Status |
|---------|---------------|-----------|--------|
| Redis tokens | ✓ | ✓ | Complete |
| Redis findings | ✓ | ✓ | Complete |
| Supabase events | ✓ | ✓ | Complete |
| Supabase findings | ✓ | ✓ | Complete |
| Supabase exploit attempts | ✓ | ✓ | Complete |
| Mission state | ✓ | ✓ | Complete |

---

## Architecture Diagrams

### Original Python Flow
```
┌─────────────────────────────────────────────────────────────────────┐
│                        GAMMA EXPLOIT LOOP                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌─────────────┐    ┌──────────────────────┐   │
│  │ LLM Plan    │───▶│ Parse JSON  │───▶│ Merge Juice Shop     │   │
│  │ (exploit)   │    │             │    │ + Fallback exploits   │   │
│  └──────────────┘    └─────────────┘    └──────────────────────┘   │
│                                                    │               │
│                                                    ▼               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              ADAPTIVE EXPLOIT GENERATION                     │   │
│  │  • LLM exploits (~5-10)                                    │   │
│  │  • Juice Shop (~20-25)  ← ALWAYS MERGED                    │   │
│  │  • Fallback (~20)       ← on parse failure                 │   │
│  │  • Variants (8 × successes)                                │   │
│  │  • TOTAL: 150-200+ exploits                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    EXECUTE EXPLOITS                          │   │
│  │  Phase 1 (token-generating) → Extract tokens → Store Redis │   │
│  │  Phase 2 (token-consuming)  → Use stored tokens            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    CRITIC EVALUATION                         │   │
│  │  • Error pattern detection                                  │   │
│  │  • Success criteria check                                   │   │
│  │  • LLM-based evaluation (Critic model)                      │   │
│  │  • Self-reflection: generate corrected payload             │   │
│  │  • Token extraction → Store to Redis                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│                    [Loop: Retry with corrected payload]           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### TypeScript Refactor Flow
```
┌─────────────────────────────────────────────────────────────────────┐
│                        GAMMA EXPLOIT LOOP                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌─────────────┐    ┌──────────────────────┐   │
│  │ LLM Plan     │───▶│ Parse JSON  │───▶│ ONLY LLM EXPLOITS    │   │
│  │ (exploit)    │    │             │    │ No fallback, no JS    │   │
│  └──────────────┘    └─────────────┘    └──────────────────────┘   │
│                                                    │               │
│  LLM fails → 0 exploits (no fallback)             │               │
│                                                    ▼               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              VARIANT GENERATION (CAPPED)                     │   │
│  │  • LLM exploits (~5-10)                                    │   │
│  │  • Variants (max 15 total)                                │   │
│  │  • TOTAL: ~7-25 exploits                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    EXECUTE EXPLOITS                          │   │
│  │  Phase 1 (token-generating) → Extract tokens → Store Redis │   │
│  │  Phase 2 (token-consuming)  → Use stored tokens            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  BASIC CRITIC (HEURISTIC)                   │   │
│  │  • HTTP code check (401/403 → retry with auth)            │   │
│  │  • 404 → skip                                            │   │
│  │  • LLM evaluation (analyze_exploit_result)                │   │
│  │  ❌ NO self-reflection loop                               │   │
│  │  ❌ NO LLM-guided correction                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                    [No retry with corrected payload]              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Gaps & Improvements Needed

### Priority 1: Critical Gaps

#### 1. Self-Reflection Loop (LLM-guided correction)

**Original Python:**
```python
async def _self_reflect_and_retry(state, failed_exploit, result, analysis):
    reflection_prompt = REFLECTION_PROMPT.format(...)
    response = await llm_client.chat(
        model=settings.exploit_model,
        messages=[{"role": "system", ...}, {"role": "user", "content": reflection_prompt}]
    )
    reflection = _parse_json_response(response)
    if reflection.get("corrected"):
        return reflection.get("new_tool_call")  # Corrected payload to retry
    return None
```

**TypeScript:** Missing entirely. Current `evaluateWithCritic()` only does basic heuristic retries.

**Action:** Implement `_self_reflect_and_retry()` that:
1. Takes failed exploit + critic feedback
2. Calls LLM to generate corrected payload
3. Returns new tool call for retry

#### 2. Dynamic Fuzzing Based on Recon

**Current State:** Both versions have hardcoded Juice Shop URLs.

**Needed:** Generate exploits dynamically from discovered endpoints:
```typescript
function buildDynamicFuzzingExploits(target: string, reconResults: ReconResult[]): ToolCall[] {
  // 1. Extract endpoints from recon
  // 2. Generate method variations (GET, POST, PUT, DELETE)
  // 3. Generate IDOR variants (different IDs)
  // 4. Generate parameter fuzzing
  // 5. Generate auth bypass header tests
}
```

**Action:** Create `buildDynamicFuzzingExploits()` that:
- Reads `recon_results` endpoints
- Generates HTTP method variations
- Generates IDOR tests with multiple IDs
- Generates parameter fuzzing tests
- Generates header manipulation tests

### Priority 2: Important Gaps

#### 3. Enhanced IDOR Variant Generation

**Original Python** generates 8-12 IDOR variants per endpoint:
```python
# For /rest/basket/1
for basket_id in [2, 3, 4, 5, 10, 99]:  # 6 variants
# For /api/Users
for user_id in [1, 2, 3, 4, 5]:  # 5 variants
```

**TypeScript** generates fewer variants (see `generateExploitVariants()`).

**Action:** Expand IDOR generation to match Python coverage.

#### 4. Token Chaining Improvements

**Original Python** stores multiple token types:
```python
# Stores: Authorization, Cookie, custom headers
await _write_shared_token(mission_id, "Authorization", f"Bearer {token_val}")
await _write_shared_token(mission_id, "Cookie", value)
```

**TypeScript** has `storeDiscoveredTokens()` but could enhance:
- Store more token types
- Implement token refresh logic
- Add JWT decoding/validation

#### 5. Full Critic Integration

**Original Python Critic** returns:
```python
{
    "success": bool,
    "severity": "critical|high|medium|low",
    "feedback": "actionable guidance",
    "error_type": "syntax_error|waf_block|auth_failure|...",
    "recommendation": "retry|pivot|chain_token|escalate|complete"
}
```

**TypeScript** `analyze_exploit_result()` returns similar but:
- Self-reflection guidance is not used
- `recommendation` field not implemented in exploit loop

**Action:** Wire up `recommendation` to drive retry/pivot logic.

### Priority 3: Nice to Have

#### 6. Semgrep Static Analysis Integration

**Original Python** has `_run_static_exploit_analysis()` for code-based vulnerabilities.

**TypeScript:** Not implemented.

#### 7. Defense Intel Integration

**Original Python** reads blue team defense patterns:
```python
defense_intel = await redis_bus.get_latest_defense_intel(count=20)
```

**TypeScript:** Blue team bridge exists but limited integration.

---

## Exploit Count Comparison

| Scenario | Original Python | TypeScript Refactor |
|----------|---------------|---------------------|
| LLM succeeds | ~5-10 + 20-25 JS + variants | ~5-10 + 6 variants = ~7-16 |
| LLM fails + tasks | N/A (tasks not used as fallback) | 0 |
| LLM fails + no tasks | ~20 fallback + variants | 0 |

### Why 200+ in Original?

1. **Juice Shop always merged** (~20-25)
2. **Fallback arsenal** (~20)
3. **Variants from successes**: 5 successes × 8 variants × 3 iterations = 120 variants
4. **Total**: 5 + 25 + 20 + 120 = **170+**

### Current TypeScript Behavior

**LLM-only** → No fallback, no Juice Shop, capped variants (15)

---

## Files Comparison

### Core Agents

| File (Python) | File (TypeScript) | Notes |
|---------------|-------------------|-------|
| `agents/gamma_exploit.py` | `src/agents/gamma-exploit.ts` | Main exploit logic |
| `agents/critic_agent.py` | `src/agents/critic-agent.ts` | Evaluation logic |
| `agents/commander.py` | `src/agents/commander.ts` | Mission orchestration |
| `agents/alpha_recon.py` | `src/agents/alpha-recon.ts` | Reconnaissance |
| `agents/graph.py` | `src/graph/langgraph.ts` | Graph execution |

### Storage

| File (Python) | File (TypeScript) |
|---------------|-------------------|
| `core/redis_bus.py` | `src/core/redis-bus.ts` |
| `core/supabase_client.py` | `src/core/supabase-client.ts` |

### Key Differences

1. **Python**: Global `state` dict, `settings` config object
2. **TypeScript**: Typed `RedTeamState`, explicit dependency injection

---

## Testing Comparison

| Aspect | Original Python | TypeScript |
|--------|---------------|-----------|
| Framework | pytest | Vitest |
| Unit tests | ✓ | ✓ |
| Integration tests | ✓ | ✓ |
| E2E tests | ✓ | Partial |
| Mocking | `unittest.mock` | `vi.mock` (Vitest) |

---

## Recommendations

### Immediate (Must Have)

1. **Implement self-reflection loop** - Critical for exploit success rate
2. **Add dynamic fuzzing engine** - Makes system target-agnostic
3. **Expand IDOR variants** - Match Python coverage
4. ~~Add hardcoded exploits toggle~~ - **Done**: `Blackboard.use_hardcoded_exploits` flag added (defaults to `false`)

### Short Term (Should Have)

4. **Wire up critic recommendations** - Drive retry/pivot logic
5. **Add token refresh logic** - Handle expired tokens
6. **Improve variant generation** - More exploit types

### Long Term (Nice to Have)

7. **Semgrep integration** - Static code analysis
8. **Defense intel integration** - Adaptive evasion
9. **Multi-target support** - Generic web app fuzzing

---

## Conclusion

The TypeScript refactor successfully:
- ✅ Implements LLM-only exploit generation (when `use_hardcoded_exploits: false`)
- ✅ Supports hardcoded exploits via `use_hardcoded_exploits` flag (matching Python behavior when enabled)
- ✅ Maintains token chaining infrastructure
- ✅ Preserves Supabase/Redis integration

However, it lacks:
- ❌ Self-reflection loop for LLM-guided correction
- ❌ Dynamic fuzzing from recon data
- ❌ Full critic integration

**Recommendation:** Focus on Priority 1 items (self-reflection + dynamic fuzzing) before further feature development.
