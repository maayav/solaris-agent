# Solaris-Agent: Model Selection Guide

**Version:** 1.0
**Date:** 2026-04-03
**Status:** Locked In — Do Not Change Without Benchmarks

---

## Overview

This document records the definitive model configuration for all 12 Solaris agents, backed by empirical benchmark data. All models were selected based on JSON generation validity rate and latency measurements.

**Critical Finding:** Ollama models scored 0–17% valid JSON on structured output tasks. They are **unreliable for JSON generation** and should only be used for non-JSON tasks (simple text comparisons, scan result parsing).

---

## Locked-In Model Configuration

Located in: `agent-swarm/src/core/models.ts`

### Tier 1: Nano Agents (Local Ollama)

| Agent | Primary Model | Fallback | Temperature | Provider | Notes |
|-------|--------------|----------|------------|----------|-------|
| `verifier` | `phi3:3.8b-mini-128k-instruct-q4_K_M` | `llama3.1:8b-instruct-q4_K_M` | 0.0 | Ollama | Simple text comparisons only |
| `critic` | `phi3:3.8b-mini-128k-instruct-q4_K_M` | `llama3.1:8b-instruct-q4_K_M` | 0.15 | Ollama | Simple text comparisons only |

**Nano Agent Constraint:** These agents do **not** generate JSON. They perform text pattern matching, classification, and simple structured output. If structured JSON is needed, use a cloud fallback.

### Tier 2: Exploit Agents (Local Ollama + Cloud Fallback)

| Agent | Primary Model | Fallback | Temperature | Provider | Notes |
|-------|--------------|----------|------------|----------|-------|
| `gamma` | `llama3-groq-tool-use:8b-q4_K_M` | `moonshotai/kimi-k2-instruct` | 0.85 | Ollama | Tool-calling optimized for ReAct loop |
| `alpha` | `qwen2.5-coder:7b-instruct-q4_K_M` | `moonshotai/kimi-k2-instruct` | 0.65 | Ollama | Code-understanding for SAST |
| `mcp` | `llama3-groq-tool-use:8b-q4_K_M` | `moonshotai/kimi-k2-instruct` | 0.65 | Ollama | Tool-calling for browser flows |
| `specialist` | `llama3-groq-tool-use:8b-q4_K_M` | `moonshotai/kimi-k2-instruct` | 0.85 | Ollama | Tool-calling for specialist tasks |
| `post_exploit` | `qwen2.5-coder:7b-instruct-q4_K_M` | `moonshotai/kimi-k2-instruct` | 0.65 | Ollama | Code-understanding for post-exploit |

**Exploit Agent Constraint:** Ollama is primary but unreliable for JSON. Use Groq `moonshotai/kimi-k2-instruct` fallback when JSON validity is critical.

### Tier 3: Commander (Cloud)

| Agent | Primary Model | Fallback | Temperature | Provider | Notes |
|-------|--------------|----------|------------|----------|-------|
| `commander` | `llama-3.3-70b-versatile` | `moonshotai/kimi-k2-instruct` | 0.5 | Groq | **FASTEST** — 367ms avg latency, 100% JSON |

### Tier 4: Planning Agents (Cloud)

| Agent | Primary Model | Fallback | Temperature | Provider | Notes |
|-------|--------------|----------|------------|----------|-------|
| `mission_planner` | `qwen-3-235b-a22b-instruct-2507` | `moonshotai/kimi-k2-instruct` | 0.85 | Cerebras | **Planning optimized** — 471ms, 100% JSON |
| `chain_planner` | `qwen-3-235b-a22b-instruct-2507` | `moonshotai/kimi-k2-instruct` | 0.85 | Cerebras | Same as mission_planner |

### Tier 5: OSINT (Cloud)

| Agent | Primary Model | Fallback | Temperature | Provider | Notes |
|-------|--------------|----------|------------|----------|-------|
| `osint` | `llama-3.1-8b` | `qwen-3-235b-a22b-instruct-2507` | 0.65 | Cerebras | Intelligence gathering |

### Tier 6: Report Agent (Cloud)

| Agent | Primary Model | Fallback | Temperature | Provider | Notes |
|-------|--------------|----------|------------|----------|-------|
| `report_agent` | `nvidia/nemotron-3-nano-30b-a3b:free` | `qwen-3-235b-a22b-instruct-2507` | 0.3 | OpenRouter | Free tier, 2M context |

---

## Benchmark Results

### Full JSON Generation Benchmark (2026-04-03)

**Benchmark Script:** `agent-swarm/benchmark-exploit-json.ts`
**Test Categories:** exploit_nmap_command, exploit_gobuster_command, exploit_ffuf_command, mission_plan_json, finding_json, code_review_json

#### Results Summary

| Rank | Model | Provider | Latency | Valid JSON % |
|------|-------|----------|---------|--------------|
| 1 | `llama-3.3-70b-versatile` | Groq | 367ms | 100% |
| 2 | `qwen-3-235b-a22b-instruct-2507` | Cerebras | 471ms | 100% |
| 3 | `moonshotai/kimi-k2-instruct` | Groq | 810ms | 100% |
| 4 | `nvidia/nemotron-3-nano-30b-a3b:free` | OpenRouter | 3,696ms | 100% |
| 5 | `google/gemma-3-27b-it` | Google | 9,868ms | 100% |
| 6 | `qwen/qwen3.6-plus:free` | OpenRouter | 19,229ms | 100% |

#### Ollama Benchmark Results (CRITICAL)

**Benchmark Script:** `agent-swarm/benchmark-ollama.ts`
**Result:** Ollama models scored **0–17% valid JSON** on structured output tasks.

| Model | Valid JSON % | Notes |
|-------|-------------|-------|
| `qwen2.5-coder:7b-instruct-q4_K_M` | 0–17% | Unreliable for JSON |
| `qwen2.5-coder:14b-instruct-q4_K_M` | 0–17% | Unreliable for JSON |
| `llama3-groq-tool-use:8b-q4_K_M` | Not tested | Tool-calling optimized, may differ |

**Recommendation:** Ollama models should **NOT** be used for tasks requiring structured JSON output. Use them only for:
- Non-JSON text generation (scan result parsing, classification)
- Tasks where output is parsed directly from stdout (tool command generation)
- Low-stakes text comparisons

---

## Provider Recommendations

### Primary Stack (Ranked by Performance)

```
#1 GROQ — 14,400 RPD free (Llama 8B) / 1K RPD (70B+)
   Best for: Commander, Gamma, exploit command generation
   Key models: llama-3.3-70b-versatile, moonshotai/kimi-k2-instruct

#2 CEREBRAS — 14,400 RPD + 1M tokens/day FREE
   Best for: Mission Planner, Chain Planner, OSINT
   Key models: qwen-3-235b-a22b-instruct-2507

#3 GOOGLE — 14,400 RPD (Gemma 27B) from AI Studio
   Best for: Large context tasks (report generation)
   Key models: gemma-3-27b-it

#4 OPENROUTER — 50 RPD only (free tier), $10 topup recommended
   Best for: Report Agent (nvidia/nemotron-3-nano-30b-a3b:free)
   Warning: Daily limits hit quickly

#5 OLLAMA — Unlimited local inference (RTX 4080)
   Best for: Always-on agents (Verifier, Critic, Alpha, Gamma, MCP)
   Warning: Poor JSON generation (0–17%). Use only for non-JSON tasks.
```

### Rate Limits

| Provider | Free Tier | Notes |
|----------|-----------|-------|
| Groq | 14,400 RPD (8B) / 1K RPD (70B+) | Best overall value |
| Cerebras | 14,400 RPD + 1M tokens/day | Best for planning |
| Google AI Studio | 14,400 RPD | Gemma 27B, slow but reliable |
| OpenRouter | 50 RPD (free) / 1000 RPD ($10) | Report Agent only |

---

## Model Selection Rationale

### Why `llama-3.3-70b-versatile` for Commander?
- Fastest cloud model: 367ms average latency
- 100% valid JSON on all tests
- Groq free tier: 1K RPD
- Excellent reasoning for strategic decisions

### Why `qwen-3-235b-a22b-instruct-2507` for Mission Planner / Chain Planner?
- 100% valid JSON at 471ms
- Cerebras free tier: 14,400 RPD + 1M tokens/day
- Large context for complex planning
- Planning-optimized architecture

### Why `moonshotai/kimi-k2-instruct` as Gamma fallback?
- 100% valid JSON at 810ms
- Groq free tier: 14,400 RPD
- Reliable JSON for exploit command generation
- Primary Ollama is unreliable for JSON

### Why `llama3-groq-tool-use:8b-q4_K_M` as Gamma primary?
- Tool-calling optimized for ReAct loop
- Local inference (fast, no rate limits)
- Still needs cloud fallback for JSON-critical tasks
- Tool-use fine-tuning helps with command generation

### Why NOT Ollama for JSON tasks?
- Benchmark confirmed: 0–17% valid JSON
- Too unreliable for structured output
- Use only for: simple text comparisons, scan result parsing
- Never use for: JSON command generation, structured findings

---

## Environment Variables

All model configs respect environment variable overrides:

```bash
# Tier 1 (Ollama)
VERIFIER_MODEL=phi3:3.8b-mini-128k-instruct-q4_K_M
VERIFIER_MODEL_FALLBACK=llama3.1:8b-instruct-q4_K_M
CRITIC_MODEL=phi3:3.8b-mini-128k-instruct-q4_K_M
CRITIC_MODEL_FALLBACK=llama3.1:8b-instruct-q4_K_M

# Tier 2 (Ollama + Groq fallback)
GAMMA_MODEL=llama3-groq-tool-use:8b-q4_K_M
GAMMA_MODEL_FALLBACK=moonshotai/kimi-k2-instruct
ALPHA_MODEL=qwen2.5-coder:7b-instruct-q4_K_M
ALPHA_MODEL_FALLBACK=moonshotai/kimi-k2-instruct
MCP_MODEL=llama3-groq-tool-use:8b-q4_K_M
MCP_MODEL_FALLBACK=moonshotai/kimi-k2-instruct
SPECIALIST_MODEL=llama3-groq-tool-use:8b-q4_K_M
SPECIALIST_MODEL_FALLBACK=moonshotai/kimi-k2-instruct
POST_MODEL=qwen2.5-coder:7b-instruct-q4_K_M
POST_MODEL_FALLBACK=moonshotai/kimi-k2-instruct

# Tier 3 (Groq)
COMMANDER_MODEL=llama-3.3-70b-versatile
COMMANDER_MODEL_FALLBACK=moonshotai/kimi-k2-instruct

# Tier 4 (Cerebras)
PLANNER_MODEL=qwen-3-235b-a22b-instruct-2507
PLANNER_MODEL_FALLBACK=moonshotai/kimi-k2-instruct
CHAIN_MODEL=qwen-3-235b-a22b-instruct-2507
CHAIN_MODEL_FALLBACK=moonshotai/kimi-k2-instruct

# Tier 5 (Cerebras)
OSINT_MODEL=llama-3.1-8b
OSINT_MODEL_FALLBACK=qwen-3-235b-a22b-instruct-2507

# Tier 6 (OpenRouter)
REPORT_MODEL=nvidia/nemotron-3-nano-30b-a3b:free
REPORT_MODEL_FALLBACK=qwen-3-235b-a22b-instruct-2507
```

---

## Important Notes

### 1. Ollama JSON Generation Is Unreliable
Do not use Ollama models for JSON generation tasks. The benchmark confirmed 0–17% valid JSON. Use cloud fallbacks when JSON validity is critical.

### 2. Temperature Settings
- **0.0**: Verifier (deterministic, no creativity needed)
- **0.15–0.5**: Critics, Commander (low creativity, high reliability)
- **0.65–0.85**: Gamma, Alpha, Planners (balanced creativity)
- **0.85–1.0**: Gamma/Specialist (high creativity for exploit variation)

### 3. Provider Rate Limits
- Groq and Cerebras are the workhorses (high RPD)
- OpenRouter is for Report Agent only (low free tier)
- Monitor TPM limits during heavy usage

### 4. RTX 4080 VRAM Budget (16GB)
```
Always loaded: Verifier (~4GB) + Alpha/Gamma (~8GB) = 12GB / 16GB
Headroom: ~4GB for OS + context

If VRAM constrained:
- Disable Alpha (use cloud only)
- Reduce Gamma pool to 1 instance
- Move Verifier to cloud
```

### 5. Fallback Chain
When a provider fails or rate limits:
```
Ollama → Groq → Cerebras → OpenRouter → Anthropic
```

The `LLMRouter` in `agent-swarm/src/core/llm-router.ts` handles this automatically.

---

## Change Protocol

**Do NOT change model configurations without:**
1. Running `benchmark-exploit-json.ts` on the new model
2. Verifying ≥95% valid JSON rate
3. Measuring latency (target: <1000ms for cloud, <500ms for local)
4. Updating this document with benchmark results
5. Committing with benchmark JSON file

---

## Benchmark Files

| File | Description |
|------|-------------|
| `agent-swarm/benchmark-complete.json` | Full benchmark results (all models) |
| `agent-swarm/benchmark-exploit-json.ts` | JSON generation benchmark script |
| `agent-swarm/benchmark-ollama.ts` | Ollama-specific benchmark |
| `agent-swarm/benchmark-ollama.json` | Ollama benchmark results |
| `agent-swarm/benchmark-partial.json` | Partial results during testing |
| `agent-swarm/benchmark-remaining.json` | Remaining models to test |

---

*Model configuration locked in: 2026-04-03*
*Do not change without benchmarks*
