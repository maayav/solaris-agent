# Solaris Agent — TypeScript + Hono + Bun Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` for parallel task execution

**Goal:** Refactor the solaris-agent codebase from mixed Python/TypeScript to unified TypeScript + Hono + Bun across frontend, vibecheck, and swarm modules, using TDD and Ralph Wiggum iterative cycles.

**Architecture:** Three-module unified stack: frontend (React + Vite + Tailwind v4), vibecheck (Hono + Neo4j), swarm (Hono + custom state machine). Modules communicate via Redis Streams with Supabase persistence.

**Tech Stack:** TypeScript 5, Bun, Hono, React 19, Vite 6, Tailwind CSS v4, Neo4j, Redis Streams, Vitest, Playwright, GSAP, TanStack Query, Zustand, Zod, React Hook Form

**Date:** 2026-03-29  
**Status:** DRAFT — Pending Review  
**Branch:** `refactor-frontend`

---

## File Structure

### Frontend Refactor (`frontend-refactor/`)

```
frontend-refactor/
├── package.json                              # [ ] Create
├── vite.config.ts                            # [x] Done
├── tsconfig.json                             # [ ] Create
├── .env / .env.example                       # [ ] Create
├── vitest.config.ts                          # [ ] Create
├── playwright.config.ts                      # [ ] Create
├── e2e/
│   ├── pages/
│   │   ├── LoginPage.ts                     # [ ] Create
│   │   ├── DashboardPage.ts                  # [ ] Create
│   │   ├── PipelinePage.ts                   # [ ] Create
│   │   ├── ChatPage.ts                      # [ ] Create
│   │   ├── SwarmPage.ts                     # [ ] Create
│   │   └── LandingPage.ts                   # [ ] Create
│   ├── components/
│   │   ├── StatCard.ts                      # [ ] Create
│   │   ├── DataTable.ts                     # [ ] Create
│   │   ├── Sidebar.ts                      # [ ] Create
│   │   └── Topbar.ts                       # [ ] Create
│   ├── helpers/
│   │   ├── auth.ts                          # [ ] Create
│   │   ├── api.ts                           # [ ] Create
│   │   └── fixtures.ts                      # [ ] Create
│   └── tests/
│       ├── login.spec.ts                    # [ ] Create
│       ├── dashboard.spec.ts                 # [ ] Create
│       ├── pipeline.spec.ts                  # [ ] Create
│       ├── chat.spec.ts                     # [ ] Create
│       ├── swarm.spec.ts                    # [ ] Create
│       ├── dead-links.spec.ts                # [ ] Create (REQUIRED)
│       ├── accessibility.spec.ts             # [ ] Create
│       └── images.spec.ts                    # [ ] Create
├── src/
│   ├── test/setup.ts                        # [ ] Create
│   ├── styles/
│   │   └── globals.css                      # [ ] Create
│   ├── app/
│   │   ├── main.tsx                         # [ ] Create
│   │   ├── providers.tsx                    # [ ] Create
│   │   └── router.tsx                      # [ ] Create
│   ├── shared/
│   │   ├── types/index.ts                   # [ ] Create
│   │   ├── constants/routes.ts              # [ ] Create
│   │   ├── hooks/
│   │   │   ├── useGSAP.ts                  # [ ] Create
│   │   │   ├── useDebounce.ts              # [ ] Create
│   │   │   ├── useMediaQuery.ts            # [ ] Create
│   │   │   └── __tests__/                  # [ ] Create per hook
│   │   ├── lib/
│   │   │   ├── axios.ts                    # [ ] Create
│   │   │   ├── queryClient.ts              # [ ] Create
│   │   │   └── cn.ts                       # [ ] Create
│   │   └── components/
│   │       ├── layout/
│   │       │   ├── DashboardLayout.tsx     # [ ] Create
│   │       │   ├── Sidebar.tsx             # [ ] Create
│   │       │   └── Topbar.tsx              # [ ] Create
│   │       ├── primitives/
│   │       │   ├── StatCard.tsx            # [ ] Create
│   │       │   ├── AnimatedNumber.tsx       # [ ] Create
│   │       │   ├── PageTransition.tsx       # [ ] Create
│   │       │   └── DataTable.tsx            # [ ] Create
│   │       └── ui/                          # [ ] shadcn components
│   └── features/
│       ├── dashboard/                       # [ ] Create (feature slice)
│       ├── pipeline/                        # [ ] Create (feature slice)
│       ├── chat/                           # [ ] Create (feature slice)
│       ├── swarm/                          # [ ] Create (feature slice)
│       └── landing/                        # [ ] Create (feature slice)
```

### VibeCheck (`vibecheck/`)

```
vibecheck/
├── package.json                             # [ ] Create
├── tsconfig.json                            # [ ] Create
├── vitest.config.ts                        # [ ] Create
├── src/
│   ├── index.ts                            # [ ] Create
│   ├── app.ts                              # [ ] Create (Hono app)
│   ├── routes/
│   │   ├── scans.ts                       # [ ] Create
│   │   └── results.ts                     # [ ] Create
│   ├── pipeline/
│   │   ├── clone.ts                       # [ ] Create
│   │   ├── parse.ts                       # [ ] Create
│   │   ├── graphInsert.ts                 # [ ] Create (Neo4j)
│   │   ├── nplus1Detector.ts             # [ ] Create
│   │   ├── semgrep.ts                    # [ ] Create
│   │   ├── semanticLift.ts               # [ ] Create
│   │   ├── llmVerify.ts                  # [ ] Create
│   │   ├── patternPropagate.ts           # [ ] Create
│   │   └── supabaseStore.ts              # [ ] Create
│   │   └── __tests__/                    # [ ] Create per stage
│   ├── agents/
│   │   └── scannerAgent.ts               # [ ] Create
│   │   └── __tests__/                    # [ ] Create
│   ├── streams/
│   │   ├── scanQueue.ts                  # [ ] Create
│   │   ├── defenseAnalytics.ts           # [ ] Create (SHARED with Swarm)
│   │   └── __tests__/                   # [ ] Create
│   └── db/
│       └── neo4j.ts                      # [ ] Create
```

### Swarm (`swarm/`)

```
swarm/
├── package.json                             # [ ] Create
├── tsconfig.json                            # [ ] Create
├── vitest.config.ts                        # [ ] Create
├── src/
│   ├── index.ts                            # [ ] Create
│   ├── app.ts                              # [ ] Create (Hono app)
│   ├── stateMachine/
│   │   ├── index.ts                       # [ ] Create
│   │   ├── transitions.ts                 # [ ] Create
│   │   ├── events.ts                      # [ ] Create
│   │   └── __tests__/                     # [ ] Create
│   ├── agents/
│   │   ├── commander.ts                   # [ ] Create
│   │   ├── alphaRecon.ts                 # [ ] Create
│   │   ├── gammaExploit.ts               # [ ] Create
│   │   ├── critic.ts                      # [ ] Create
│   │   ├── hitlGate.ts                   # [ ] Create
│   │   └── __tests__/                    # [ ] Create per agent
│   ├── llm/
│   │   ├── cascade.ts                    # [ ] Create
│   │   ├── orchestrator.ts               # [ ] Create
│   │   └── __tests__/                    # [ ] Create
│   ├── tools/
│   │   ├── nmap.ts                       # [ ] Create
│   │   ├── curl.ts                       # [ ] Create
│   │   ├── sqlmap.ts                     # [ ] Create
│   │   ├── nuclei.ts                     # [ ] Create
│   │   ├── ffuf.ts                       # [ ] Create
│   │   ├── jwtTool.ts                    # [ ] Create
│   │   ├── webSearch.ts                  # [ ] Create
│   │   ├── sandbox.ts                    # [ ] Create
│   │   └── __tests__/                    # [ ] Create per tool
│   └── streams/
│       ├── a2aMessages.ts                # [ ] Create
│       ├── missionEvents.ts              # [ ] Create
│       └── __tests__/                   # [ ] Create
```

---

## Table of Contents

1. [Scope & Architecture Summary](#1-scope--architecture-summary)
2. [Code Audit & Refactor Targets](#2-code-audit--refactor-targets)
3. [TDD Approach](#3-tdd-approach)
4. [Vitest Unit/Integration Test Plan](#4-vitest-unitintegration-test-plan)
5. [Playwright E2E Test Plan](#5-playwright-e2e-test-plan)
6. [Iterative Phases — Ralph Wiggum Cycles](#6-iterative-phases--ralph-wiggum-cycles)
7. [Error Classification Framework](#7-error-classification-framework)
8. [Done Criteria per Phase](#8-done-criteria-per-phase)
9. [Test Execution Infrastructure](#9-test-execution-infrastructure)
10. [Hardblocks & Dependencies](#10-hardblocks--dependencies)

---

## 1. Scope & Architecture Summary

### 1.1 Three-Module Unified Stack

| Module | Current Stack | Target Stack | Rewrite Type |
|--------|-------------|-------------|--------------|
| `frontend/` | React 19 + TS5 + Vite + Tailwind v4 | React 19 + TS5 + Bun + Vite + Tailwind v4 + Hono (proxy) | Incremental refactor |
| `vibecheck/` | Python 3.12 + FastAPI + FalkorDB | TypeScript + Hono + Bun + Neo4j + Zod | Full rewrite |
| `swarm/` | Python 3.10 + LangGraph + LangChain | TypeScript + Hono + Bun + Custom State Machine | Full ground-up redesign |

### 1.2 Target Architecture Principles

- **FSA (Feature-Sliced Architecture)** for frontend structure
- **Container/Presenter** pattern for UI components
- **Custom state machines** replacing LangGraph (no TS equivalent)
- **Custom LLM orchestration** replacing LangChain (no TS equivalent)
- **Neo4j** (openCypher) replacing FalkorDB (native TS driver available)
- **Redis Streams** for A2A messaging (shared across modules)
- **Supabase** for persistence

### 1.3 Shared Contracts (MUST LOCK before Phase 2)

```
defense_analytics stream — shared between VibeCheck and Swarm
schema must be frozen before Phase 2 of either module
```

---

## 2. Code Audit & Refactor Targets

### 2.1 Frontend (`frontend/`)

#### Hardblocks (MUST FIX BEFORE BUN)
| Issue | File | Fix |
|-------|------|-----|
| `better-sqlite3` | `frontend/package.json` | Remove entirely — Bun cannot use node-addons |
| `express` bundled | `frontend/package.json` | Remove — frontend has no server |
| `@types/react-router-dom` v5 | `frontend/package.json` | Replace with v7 types (React Router v7 in use) |

#### Unused Dependencies (Remove during scaffold)
| Package | Reason |
|---------|--------|
| `zustand` | Not used — will be re-added in scaffold |
| `@tanstack/react-query` | Not used — will be re-added in scaffold |
| `react-hook-form` | Not used — will be re-added in scaffold |
| `zod` | Not used — will be re-added in scaffold |
| `@phosphor-icons/react` | Not used — will be re-added in scaffold |
| `framer-motion` | Redundant — GSAP is target |
| `motion` | Redundant — GSAP is target |

#### Refactor Targets
- [ ] Excise `better-sqlite3`, `express`, wrong types from `frontend/package.json`
- [ ] Flat component structure → FSA with 5 feature slices
- [ ] No state management → TanStack Query + Zustand
- [ ] No forms → React Hook Form + Zod
- [ ] No tests → Vitest RTL + Playwright E2E
- [ ] No animation strategy → GSAP page transitions, number counters, sidebar collapse
- [ ] No API layer → Axios singleton with interceptors
- [ ] No lazy loading → React Router v7 lazy routes

### 2.2 VibeCheck (`vibecheck/`)

#### Refactor Targets
- [ ] Python → TypeScript + Hono + Bun
- [ ] FastAPI → Hono routing + Zod validation
- [ ] FalkorDB → **Neo4j** (openCypher queries, official JS driver)
- [ ] Semgrep CLI subprocess → Semgrep Cloud API
- [ ] Angular.js legacy dashboard → Deprioritized to Phase 10
- [ ] No tests → Full Vitest + Playwright coverage

#### FalkorDB → Neo4j Migration Notes
```typescript
// Same openCypher queries work
// Driver: neo4j-driver (official)
// Connection: bolt://localhost:7687 or wss:// for TLS
```

#### 9-Stage Pipeline (preserved, TS reimplementation)
1. Clone repository
2. Tree-Sitter parse
3. FalkorDB → **Neo4j** graph insert
4. N+1 query detection
5. Semgrep → **Semgrep Cloud API**
6. Semantic lifting
7. LLM verification (OpenRouter cascade)
8. Pattern propagation
9. Supabase storage

### 2.3 Swarm (`swarm/`)

#### Refactor Targets — FULL GROUND-UP REDESIGN
- [ ] Python → TypeScript + Hono + Bun
- [ ] LangGraph → **Custom state machine** (5-phase: planning → recon → exploitation → reporting → complete)
- [ ] LangChain → **Custom LLM orchestration service**
- [ ] No tests → Full Vitest + Playwright coverage

#### LangGraph → Custom State Machine Design

```
State: { phase, agents, findings, approved, mission_id, ... }
Transitions: planning → recon → exploitation → reporting → complete
             ↑______________|  (reject loop back to planning)
             
Events: MISSION_START, PHASE_COMPLETE, HITL_APPROVE, HITL_REJECT, TOOL_ERROR, AGENT_FAIL
```

#### LangChain → Custom LLM Orchestration

```
LLMCascade:
  tier1: openrouter/gpt-4o (primary)
  tier2: openrouter/claude-3.5-sonnet (fallback)
  tier3: openrouter/llama-3.1-70b (fallback)
  tier4: ollama/llama3 (local fallback)
  
  On failure: try next tier with exponential backoff
  Circuit breaker: 3 failures → stop cascade
```

#### 5 Agents (TS redesign)
| Agent | Responsibility | Notes |
|-------|---------------|-------|
| Commander | Orchestration, phase transitions | 1096 lines → design from scratch |
| Alpha Recon | Passive reconnaissance | 661 lines → design from scratch |
| Gamma Exploit | Active exploitation + PentAGI loop | 1823 lines → most complex, design from scratch |
| Critic | Self-reflection, quality gate | 1065 lines → design from scratch |
| HITL Gate | Human-in-the-loop approval | ~100 lines → simplest |

#### 9 Tools (TS wrappers)
| Tool | Language | Wrapper Needed |
|------|----------|---------------|
| nmap | C | Node child_process |
| nuclei | Go | Node child_process |
| curl | C | Node built-in |
| python_exec | Python | Node child_process |
| sqlmap | Python | Node child_process |
| ffuf | Go | Node child_process |
| jwt_tool | Python | Node child_process |
| web_search | — | HTTP client (SerpAPI/Tavily) |
| sandbox | — | Docker API |

---

## 3. TDD Approach

### 3.1 Core Principle

> **"NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST"**

Per `react-web` skill: Test-First Development is MANDATORY. Every unit of production code must be preceded by a failing test that defines the expected behavior.

### 3.2 Red-Green-Refactor Cycle

```
┌─────────────────────────────────────────────────────────┐
│  RED: Write a failing test                               │
│  - Test compiles but does NOT pass                       │
│  - Defines expected behavior before implementation       │
│  - One assertion at a time (simplest possible test)      │
├─────────────────────────────────────────────────────────┤
│  GREEN: Write minimum code to make test pass              │
│  - Do NOT optimize, do NOT add features                  │
│  - Just enough to make RED → GREEN                      │
│  - No "future-proofing"                                  │
├─────────────────────────────────────────────────────────┤
│  REFACTOR: Improve code (test stays GREEN)               │
│  - Extract helpers, reduce duplication                   │
│  - Improve naming, add documentation                     │
│  - Re-run all tests to ensure nothing broke              │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Test Naming Convention

```
module.feature.scenario.shouldExpectedBehavior

Examples:
- frontend.dashboard.statCard.shouldRenderValue
- frontend.dashboard.statCard.shouldAnimateOnMount
- frontend.pipeline.scan.shouldCreateScan
- vibecheck.pipeline.nplus1.shouldDetectNPlus1
- swarm.commander.shouldTransitionToRecon
```

### 3.4 Test File Location Convention

```
Frontend:
  src/features/dashboard/__tests__/statCard.test.tsx
  src/shared/hooks/__tests__/useGSAP.test.ts

VibeCheck:
  src/agents/__tests__/commander.test.ts
  src/pipeline/__tests__/nplus1Detector.test.ts

Swarm:
  src/agents/__tests__/commander.test.ts
  src/stateMachine/__tests__/transition.test.ts
```

### 3.5 Error Classification Before Every Iteration

Per `iterative-development` skill, before each Ralph Wiggum loop:

| Classification | Action |
|---------------|--------|
| **Code/Logic Error** | Continue loop, fix in next iteration |
| **Access/Env Error** | STOP immediately, report as hardblock |
| **Third-party API Error** | Log + skip + continue, do not fail build |

---

## 4. Vitest Unit/Integration Test Plan

### 4.1 Frontend

#### Coverage Targets
| Metric | Target |
|--------|--------|
| Line coverage | >90% |
| Function coverage | >85% |
| Branch coverage | >80% |

#### Test Categories

**4.1.1 Component Tests (React Testing Library)**
```typescript
// Per FRONTEND_PLAN.md §5.3.1
describe('StatCard', () => {
  shouldRenderValue()
  shouldRenderLabel()
  shouldRenderIcon()
  shouldApplyColorVariant()
  shouldAnimateOnMount() // GSAP
  shouldCleanupAnimation()
})

describe('DataTable', () => {
  shouldRenderHeaders()
  shouldRenderRows()
  shouldHandleEmptyState()
  shouldSupportSorting()
  shouldSupportPagination()
  shouldRenderCompoundChildren() // compound component pattern
})

describe('AnimatedNumber', () => {
  shouldRenderInitialValue()
  shouldAnimateToTargetValue()
  shouldRespectDuration()
  shouldEaseOut()
})

describe('PageTransition', () => {
  shouldApplyStaggerAnimation()
  shouldApplyFadeSlide()
  shouldSupportGSAPTimeline()
})
```

**4.1.2 Hook Tests**
```typescript
// src/shared/hooks/__tests__/
useGSAP.test.ts
  - shouldRegisterGSAPContext()
  - shouldCleanupOnUnmount()
  - shouldReturnAnimationTimeline()

useDebounce.test.ts
  - shouldDebounceValue()
  - shouldRespectDelay()
  - shouldCallImmediatelyOnMount()

useMediaQuery.test.ts
  - shouldMatchMediaQuery()
  - shouldUpdateOnResize()
  - shouldReturnNullOnServer()
```

**4.1.3 API Layer Tests**
```typescript
// src/shared/api/__tests__/
axios.test.ts
  - shouldBeSingleton()
  - shouldAttachAuthToken()
  - shouldHandle401()
  - shouldRetryOn500()
  - shouldTimeout()

queryClient.test.ts
  - shouldCacheResponses()
  - shouldInvalidateOnMutation()
  - shouldStaleTime()
```

**4.1.4 Form Tests**
```typescript
// src/features/*/components/*.test.tsx
LoginForm.test.tsx
  - shouldValidateEmail()
  - shouldValidatePassword()
  - shouldSubmitOnValid()
  - shouldShowErrorsOnInvalid()
  - shouldDisableDuringSubmit()
```

**4.1.5 GSAP Animation Tests**
```typescript
// Critical per FRONTEND_PLAN.md §7
describe('GSAP Animations', () => {
  shouldStaggerPageEntry()
  shouldCountUpNumbers()
  shouldCollapseSidebar()
  shouldTransitionPages()
})
```

### 4.2 VibeCheck

#### Coverage Targets
| Metric | Target |
|--------|--------|
| Line coverage | >85% |
| Function coverage | >85% |
| Branch coverage | >80% |

#### Test Categories

**4.2.1 Pipeline Stage Tests (mock external deps)**
```typescript
// src/pipeline/__tests__/
cloneStage.test.ts
  - shouldCloneRepository()
  - shouldHandleCloneFailure()
  - shouldCleanupOnAbort()

parseStage.test.ts
  - shouldParseWithTreeSitter()
  - shouldExtractFunctions()
  - shouldExtractImports()

graphInsert.test.ts
  - shouldInsertNodes()
  - shouldInsertEdges()
  - shouldHandleDuplicateNodes()
  - SHOULD USE Neo4j JS DRIVER (real connection or mock)

nplus1Detector.test.ts
  - shouldDetectNPlus1Pattern()
  - shouldNotFlagOneToOne()
  - shouldScoreSeverity()

semgrepStage.test.ts (mock Semgrep Cloud API)
  - shouldCallSemgrepAPI()
  - shouldParseFindings()
  - shouldHandleRateLimit()

llmVerification.test.ts (mock OpenRouter)
  - shouldCallLLM()
  - shouldParseResponse()
  - shouldHandleTimeout()

patternPropagation.test.ts
  - shouldPropagatePatterns()
  - shouldRespectTTL()
```

**4.2.2 Stream Tests (Redis)**
```typescript
// src/streams/__tests__/
scanQueue.test.ts
  - shouldPublishScan()
  - shouldConsumeScan()
  - shouldHandleBackpressure()

defenseAnalytics.test.ts
  - shouldPublishEvent() // SHARED with Swarm
  - shouldConsumeEvent()
  - shouldRespectSchema() // MUST MATCH Swarm's expectations
```

**4.2.3 Agent Tests**
```typescript
// src/agents/__tests__/
scannerAgent.test.ts
  - shouldCreateScan()
  - shouldUpdateStatus()
  - shouldPublishCompletion()
```

### 4.3 Swarm

#### Coverage Targets
| Metric | Target |
|--------|--------|
| Line coverage | >85% |
| Function coverage | >85% |
| Branch coverage | >80% |

#### Test Categories

**4.3.1 State Machine Tests**
```typescript
// src/stateMachine/__tests__/
stateMachine.test.ts
  - shouldStartInPlanning()
  - shouldTransitionToRecon()
  - shouldTransitionToExploitation()
  - shouldTransitionToReporting()
  - shouldTransitionToComplete()
  - shouldRejectToPlanning()
  - shouldHandleInvalidTransition()

events.test.ts
  - shouldEmitMissionStart()
  - shouldEmitPhaseComplete()
  - shouldEmitHITLApprove()
  - shouldEmitHITLReject()
```

**4.3.2 Agent Behavioral Tests**
```typescript
// src/agents/__tests__/
commander.test.ts
  - shouldAssignReconTask()
  - shouldAssignExploitTask()
  - shouldRequestHITLApproval()
  - shouldTransitionPhase()

alphaRecon.test.ts
  - shouldPerformPassiveRecon()
  - shouldReturnSubdomains()
  - shouldReturnOpenPorts()

gammaExploit.test.ts
  - shouldPerformExploitation()
  - shouldTriggerSelfReflection()
  - shouldLoopOnFailure() // PentAGI pattern
  - shouldStopAfterMaxAttempts()

critic.test.ts
  - shouldEvaluateFindings()
  - shouldScoreQuality()
  - shouldApproveOrReject()
```

**4.3.3 LLM Cascade Tests**
```typescript
// src/llm/__tests__/
cascade.test.ts
  - shouldTryTier1()
  - shouldFallbackToTier2()
  - shouldFallbackToTier3()
  - shouldFallbackToOllama()
  - shouldStopAfter3Failures()
  - shouldReturnResult()
  - shouldTimeout()
```

**4.3.4 Tool Wrapper Tests**
```typescript
// src/tools/__tests__/
nmap.test.ts
  - shouldExecuteNmap()
  - shouldParseOutput()
  - shouldTimeout()

curl.test.ts
  - shouldMakeRequest()
  - shouldHandleResponse()
  - shouldHandleError()

sqlmap.test.ts
  - shouldExecuteSqlmap()
  - shouldParseSQLInjection()
```

**4.3.5 Redis Streams Tests**
```typescript
// src/streams/__tests__/
a2aMessages.test.ts
  - shouldPublishMessage()
  - shouldConsumeMessage()
  - shouldHandleRouting()

missionEvents.test.ts
  - shouldPublishMissionStart()
  - shouldPublishPhaseTransition()
```

---

## 5. Playwright E2E Test Plan

### 5.1 Configuration

```typescript
// playwright.config.ts
export default {
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['json', { outputFile: 'playwright-report.json' }]],
  
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
};
```

### 5.2 Page Object Model Structure

```
e2e/
├── pages/
│   ├── LoginPage.ts
│   ├── DashboardPage.ts
│   ├── PipelinePage.ts
│   ├── ChatPage.ts
│   ├── SwarmPage.ts
│   └── LandingPage.ts
├── components/
│   ├── StatCard.ts
│   ├── DataTable.ts
│   ├── Sidebar.ts
│   └── Topbar.ts
├── helpers/
│   ├── auth.ts
│   ├── api.ts
│   └── fixtures.ts
└── tests/
    ├── login.spec.ts
    ├── dashboard.spec.ts
    ├── pipeline.spec.ts
    ├── chat.spec.ts
    ├── swarm.spec.ts
    ├── dead-links.spec.ts
    └── accessibility.spec.ts
```

### 5.3 Frontend E2E Tests

#### 5.3.1 Login Flow
```typescript
// e2e/tests/login.spec.ts
test('should login with valid credentials', async ({ page }) => {
  await page.goto('/login');
  await loginPage.fillEmail('test@example.com');
  await loginPage.fillPassword('password123');
  await loginPage.submit();
  await loginPage.shouldRedirectTo('/dashboard');
});

test('should show error with invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await loginPage.fillEmail('bad@example.com');
  await loginPage.fillPassword('wrong');
  await loginPage.submit();
  await loginPage.shouldShowError('Invalid credentials');
});
```

#### 5.3.2 Dashboard
```typescript
// e2e/tests/dashboard.spec.ts
test('should display stat cards with animations', async ({ page }) => {
  await page.goto('/dashboard');
  await dashboardPage.shouldShowStatCards();
  await dashboardPage.shouldAnimateNumbers();
});

test('should filter by date range', async ({ page }) => {
  await page.goto('/dashboard');
  await dashboardPage.selectDateRange('7d');
  await dashboardPage.shouldUpdateCharts();
});
```

#### 5.3.3 Pipeline
```typescript
// e2e/tests/pipeline.spec.ts
test('should create and run a scan', async ({ page }) => {
  await page.goto('/pipeline');
  await pipelinePage.clickNewScan();
  await pipelinePage.fillTarget('https://example.com');
  await pipelinePage.selectAgents(['nmap', 'sqlmap']);
  await pipelinePage.startScan();
  await pipelinePage.shouldShowProgress();
  await pipelinePage.waitForCompletion();
  await pipelinePage.shouldShowResults();
});
```

#### 5.3.4 Chat
```typescript
// e2e/tests/chat.spec.ts
test('should send and receive messages', async ({ page }) => {
  await page.goto('/chat');
  await chatPage.sendMessage('Hello');
  await chatPage.shouldSeeMessage('Hello', { type: 'sent' });
  await chatPage.shouldReceiveResponse();
});
```

#### 5.3.5 Swarm
```typescript
// e2e/tests/swarm.spec.ts
test('should create mission and see agents activate', async ({ page }) => {
  await page.goto('/swarm');
  await swarmPage.clickNewMission();
  await swarmPage.fillMissionName('Test Mission');
  await swarmPage.selectTarget('192.168.1.1');
  await swarmPage.startMission();
  await swarmPage.shouldSeePhaseTransition('planning', 'recon');
  await swarmPage.shouldSeeAgentActivity('Alpha Recon');
});
```

### 5.4 VibeCheck E2E Tests

```typescript
// e2e/vibecheck.spec.ts
test('should run full scan pipeline', async ({ page }) => {
  await page.goto('/vibecheck');
  await vibecheckPage.createScan();
  await vibecheckPage.selectTarget('https://example.com');
  await vibecheckPage.runScan();
  await vibecheckPage.waitForCompletion();
  await vibecheckPage.shouldShowVulnerabilities();
});
```

### 5.5 Swarm E2E Tests

```typescript
// e2e/swarm.spec.ts
test('should complete full mission lifecycle', async ({ page }) => {
  await page.goto('/swarm');
  await swarmPage.createMission();
  await swarmPage.observePhaseTransitions();
  await swarmPage.approveHITL();
  await swarmPage.shouldComplete();
});
```

### 5.6 DEAD LINK DETECTION (REQUIRED)

Per `playwright-testing` skill §713+, dead link detection is **REQUIRED** on every PR:

```typescript
// e2e/tests/dead-links.spec.ts

/idal_links_test('should detect dead links on landing page', async ({ page }) => {
  const baseURL = 'http://localhost:5173';
  const response = await page.goto(`${baseURL}/landing`);
  
  const links = await page.locator('a[href]').evaluateAll((elements) =>
    elements.map((el) => ({
      href: el.getAttribute('href'),
      text: el.textContent,
    }))
  );

  const externalLinks = links.filter((link) => link.href.startsWith('http'));
  const internalLinks = links.filter((link) => !link.href.startsWith('http'));

  // Check internal links
  for (const link of internalLinks) {
    const url = new URL(link.href, baseURL);
    const response = await page.request.get(url.href);
    expect(response.status()).toBeLessThan(400);
  }

  // Check external links (with timeout)
  for (const link of externalLinks) {
    try {
      const response = await page.request.fetch(link.href, { timeout: 5000 });
      expect(response.status()).toBeLessThan(400);
    } catch {
      console.warn(`Dead external link: ${link.href}`);
    }
  }
});

test('should detect dead links on all pages', async ({ page }) => {
  const pages = ['/', '/dashboard', '/pipeline', '/chat', '/swarm'];
  for (const path of pages) {
    await page.goto(path);
    const links = await page.locator('a[href]').all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('#')) {
        const response = await page.request.get(href);
        expect(response.status()).toBeLessThan(400);
      }
    }
  }
});
```

### 5.7 Accessibility Tests

```typescript
// e2e/tests/accessibility.spec.ts
test('should meet WCAG 2.1 AA standards', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveNoViolations();
});

test('should have proper focus management', async ({ page }) => {
  await page.goto('/dashboard');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});
```

### 5.8 Image Validation

```typescript
// e2e/tests/images.spec.ts
test('should load all images without 404', async ({ page }) => {
  await page.goto('/dashboard');
  const images = page.locator('img');
  const count = await images.count();
  
  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    const response = await page.request.get(await img.getAttribute('src'));
    expect(response.status()).toBe(200);
  }
});
```

---

## 6. Iterative Phases — Ralph Wiggum Cycles

### Phase Philosophy

Per `iterative-development` skill: Ralph Wiggum loops = self-referential TDD iteration until tests pass. Max 3 iterations per task. If not passing by iteration 3, STOP and escalate.

### Phase 1: Frontend Scaffold Completion

**Goal:** Complete 14-phase scaffold per FRONTEND_PLAN.md §14

**Ralph Wiggum Loop (max 3 iterations per sub-task):**
```
Task: Complete tsconfig.json
  Iteration 1: Create base config → verify tsconfig.json exists
  Iteration 2: Add paths → verify paths work
  Iteration 3: Add strict → run tsc --noEmit
  If FAIL after 3: STOP → escalate

Task: Complete .env
  Similar 3-iteration loop

Task: Complete globals.css
  Similar 3-iteration loop
```

**Sub-tasks in order:**
1. [ ] `tsconfig.json` — base + paths + strict mode
2. [ ] `.env` + `.env.example`
3. [ ] `src/styles/globals.css` — Tailwind v4 + CSS variables
4. [ ] `src/shared/lib/` — axios singleton, queryClient, cn()
5. [ ] `src/shared/types/index.ts`
6. [ ] `src/shared/constants/routes.ts`
7. [ ] `src/app/providers.tsx`, `router.tsx`, `main.tsx`
8. [ ] `src/shared/hooks/` — useGSAP, useDebounce, useMediaQuery
9. [ ] `src/shared/components/layout/` — DashboardLayout, Sidebar, Topbar
10. [ ] `src/shared/components/primitives/` — StatCard, AnimatedNumber, PageTransition, DataTable
11. [ ] `src/shared/components/ui/` — shadcn base components
12. [ ] `src/features/dashboard/` — feature slice
13. [ ] `src/features/pipeline/` — feature slice
14. [ ] `src/features/chat/` — feature slice
15. [ ] `src/features/swarm/` — feature slice
16. [ ] `src/features/landing/` — feature slice

**Completion Promise:**
`<promise>PHASE 1 COMPLETE: Frontend scaffold finished, all files exist, builds without error</promise>`

**Exit Condition:**
```bash
cd frontend-refactor
bun run build  # must succeed
bun run typecheck  # must succeed (tsc --noEmit)
```

---

### Phase 2: Frontend TFD Implementation

**Goal:** Implement features with Test-First Development per react-web SKILL.md

**Ralph Wiggum Loop:**
```
Feature: StatCard component
  RED: Write test for shouldRenderValue → verify it FAILS
  GREEN: Implement StatCard → verify test PASSES
  REFACTOR: Clean up implementation → verify tests still pass
  Repeat for next assertion

  Exit: All assertions pass, coverage >90%
  If FAIL after 3 iterations: STOP → escalate
```

**Sub-tasks:**
1. [ ] Dashboard feature TFD (StatCard, charts, filters)
2. [ ] Pipeline feature TFD (scan form, results table)
3. [ ] Chat feature TFD (message list, input)
4. [ ] Swarm feature TFD (mission card, phase indicator)
5. [ ] Landing feature TFD (hero, features, pricing)
6. [ ] Shared primitives TFD (AnimatedNumber, PageTransition)
7. [ ] GSAP animation integration tests

**Completion Promise:**
`<promise>PHASE 2 COMPLETE: All frontend features have passing tests, >90% line coverage</promise>`

**Exit Condition:**
```bash
cd frontend-refactor
bun run test:unit --coverage  # all pass, line >90%
bun run test:e2e  # all pass
```

---

### Phase 3: VibeCheck Contract Locking + Hono Scaffolding

**Goal:** Lock shared `defense_analytics` contract + scaffold VibeCheck TS/Hono

**IMPORTANT:** Before Phase 3, coordinate with Swarm team to lock `defense_analytics` schema.

**Ralph Wiggum Loop:**
```
Task: Define defense_analytics schema
  Iteration 1: Draft schema → review with Swarm
  Iteration 2: Implement in VibeCheck producer → write tests
  Iteration 3: Verify with Swarm consumer → full integration test
  If FAIL: STOP → escalate blocker
```

**Sub-tasks:**
1. [ ] Lock `defense_analytics` stream schema with Swarm team
2. [ ] Scaffold VibeCheck TypeScript + Hono project
3. [ ] Implement Neo4j connection + graph insert
4. [ ] Implement 9-stage pipeline (TFD)
5. [ ] Implement Redis Streams producers/consumers
6. [ ] Write Vitest unit tests for pipeline stages
7. [ ] Write Playwright E2E for scan creation/results

**Completion Promise:**
`<promise>PHASE 3 COMPLETE: VibeCheck pipeline works end-to-end, defense_analytics schema locked</promise>`

**Exit Condition:**
```bash
cd vibecheck
bun run build  # must succeed
bun run test:unit  # all pass
curl -X POST http://localhost:3000/scans  # creates scan, returns 201
```

---

### Phase 4: Swarm State Machine Design (Ground-Up)

**Goal:** Design and implement custom state machine replacing LangGraph

**Ralph Wiggum Loop:**
```
Task: Design state machine transitions
  RED: Write test for planning → recon transition → verify FAILS
  GREEN: Implement transition logic → verify PASSES
  REFACTOR: Simplify → verify tests still pass
  
  Task: Design LLM cascade
  RED: Write test for tier1 failure → tier2 fallback → verify FAILS
  GREEN: Implement cascade → verify PASSES
  REFACTOR: Add circuit breaker → verify still passes
```

**Sub-tasks:**
1. [ ] Design 5-phase state machine (planning → recon → exploitation → reporting → complete)
2. [ ] Implement state transitions with events
3. [ ] Design LLM cascade (4 tiers with fallback)
4. [ ] Implement 5 agents (Commander, Alpha Recon, Gamma Exploit, Critic, HITL Gate)
5. [ ] Implement 9 tool wrappers
6. [ ] Write Vitest unit tests for state machine
7. [ ] Write Vitest unit tests for agents
8. [ ] Write Playwright E2E for mission lifecycle

**Completion Promise:**
`<promise>PHASE 4 COMPLETE: Swarm state machine works, all 5 agents operational, LLM cascade functional</promise>`

**Exit Condition:**
```bash
cd swarm
bun run build  # must succeed
bun run test:unit  # all pass
# Manual verification: create mission → observe 5-phase transition
```

---

### Phase 5: Integration Testing

**Goal:** End-to-end integration tests across all modules

**Sub-tasks:**
1. [ ] VibeCheck ↔ Swarm integration via `defense_analytics`
2. [ ] Frontend ↔ VibeCheck API integration
3. [ ] Frontend ↔ Swarm mission control integration
4. [ ] Redis Streams cross-module integration
5. [ ] Full Playwright E2E across all modules

**Completion Promise:**
`<promise>PHASE 5 COMPLETE: All modules integrated, full E2E passing</promise>`

---

### Phase 6: Optimization & Hardening

**Goal:** Performance, security, reliability hardening

**Sub-tasks:**
1. [ ] Load testing (k6 or autocannon)
2. [ ] Security audit (OWASP checklist)
3. [ ] Error handling refinement
4. [ ] Logging/tracing improvement
5. [ ] Docker deployment configuration

---

## 7. Error Classification Framework

Before every Ralph Wiggum iteration, classify the error:

| Error Type | Classification | Action |
|------------|---------------|--------|
| TypeScript compilation error | **Code** | Fix in loop |
| Test assertion failure | **Logic** | Fix in loop |
| Wrong test setup | **Code** | Fix test, then re-run |
| Environment variable missing | **Access/Env** | STOP → report blocker |
| Docker not running | **Access/Env** | STOP → report blocker |
| Neo4j connection refused | **Access/Env** | STOP → report blocker |
| Redis connection refused | **Access/Env** | STOP → report blocker |
| Third-party API timeout | **External** | Log → skip → continue |
| Third-party API 500 | **External** | Log → retry with backoff → continue |
| OpenRouter rate limit | **External** | Log → wait → retry |

**Rule:** Code/Logic errors → continue loop. Access/Env errors → STOP immediately.

---

## 8. Done Criteria per Phase

### Evidence Before Claims

For every phase completion claim, run actual verification commands and show real output. No "should work", "looks correct", "probably fine" language.

### Phase 1 Done Criteria

| Criterion | Verification Command | Expected |
|-----------|---------------------|----------|
| tsconfig.json exists | `test -f frontend-refactor/tsconfig.json && echo "EXISTS"` | EXISTs |
| Builds without error | `cd frontend-refactor && bun run build` | exit code 0 |
| TypeScript passes | `cd frontend-refactor && bun run typecheck` | no errors |
| All 16 scaffold files exist | `ls frontend-refactor/src/{app,shared,features}` | directories populated |

### Phase 2 Done Criteria

| Criterion | Verification Command | Expected |
|-----------|---------------------|----------|
| All unit tests pass | `cd frontend-refactor && bun run test:unit` | 100% pass |
| Line coverage >90% | `cd frontend-refactor && bun run test:unit --coverage` | line >90% |
| All E2E tests pass | `cd frontend-refactor && bun run test:e2e` | 100% pass |
| Dead link test passes | `cd frontend-refactor && bun run test:e2e --grep "dead link"` | 0 failures |
| Accessibility test passes | `cd frontend-refactor && bun run test:e2e --grep "accessibility"` | 0 violations |

### Phase 3 Done Criteria

| Criterion | Verification Command | Expected |
|-----------|---------------------|----------|
| VibeCheck builds | `cd vibecheck && bun run build` | exit code 0 |
| Unit tests pass | `cd vibecheck && bun run test:unit` | 100% pass |
| Pipeline E2E passes | `cd vibecheck && bun run test:e2e` | 100% pass |
| Scan creates successfully | `curl -X POST http://localhost:3000/scans -d '{"target":"https://example.com"}'` | 201 |
| Neo4j has nodes | `cypher-shell "MATCH (n) RETURN count(n)"` | count > 0 |

### Phase 4 Done Criteria

| Criterion | Verification Command | Expected |
|-----------|---------------------|----------|
| Swarm builds | `cd swarm && bun run build` | exit code 0 |
| State machine tests pass | `cd swarm && bun run test:unit --grep "state machine"` | 100% pass |
| Agent tests pass | `cd swarm && bun run test:unit --grep "agent"` | 100% pass |
| LLM cascade tests pass | `cd swarm && bun run test:unit --grep "cascade"` | 100% pass |
| Mission E2E passes | Manual: create mission → observe 5-phase transition | all phases transition |

### Phase 5 Done Criteria

| Criterion | Verification Command | Expected |
|-----------|---------------------|----------|
| Cross-module integration | `curl http://localhost:5173/api/vibecheck/scans` | returns scan data |
| Defense analytics flows | Redis: `XRANGE defense_analytics 0 +` | events present |
| Full E2E suite | `bun run test:e2e` from root | 100% pass |

---

## 9. Test Execution Infrastructure

### 9.1 Vitest Configuration

```typescript
// vitest.config.ts (frontend-refactor)
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 90,
        functions: 85,
        branches: 80,
      },
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 9.2 Playwright Configuration

```typescript
// playwright.config.ts (frontend-refactor)
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 12'] } },
  ],
});
```

### 9.3 Pre-Push Checklist

```bash
#!/bin/bash
# .git/hooks/pre-push

echo "Running pre-push checks..."

# Frontend
cd frontend-refactor
bun run typecheck || { echo "TypeScript failed"; exit 1; }
bun run lint || { echo "Lint failed"; exit 1; }
bun run test:unit --coverage || { echo "Unit tests failed"; exit 1; }
bun run test:e2e || { echo "E2E tests failed"; exit 1; }

# VibeCheck
cd ../vibecheck
bun run typecheck || { echo "TypeScript failed"; exit 1; }
bun run test:unit || { echo "Unit tests failed"; exit 1; }

# Swarm
cd ../swarm
bun run typecheck || { echo "TypeScript failed"; exit 1; }
bun run test:unit || { echo "Unit tests failed"; exit 1; }

echo "All checks passed!"
```

---

## 10. Hardblocks & Dependencies

### 10.1 Active Hardblocks

| Hardblock | Module | Blocker For | Status |
|-----------|--------|-------------|--------|
| `better-sqlite3` in frontend | frontend | Bun migration | MUST remove before Phase 1 |
| `express` in frontend bundle | frontend | Bun migration | MUST remove before Phase 1 |
| `@types/react-router-dom` v5 | frontend | React Router v7 | MUST replace before Phase 1 |
| FalkorDB has no TS driver | vibecheck | Neo4j migration | MUST switch to Neo4j |
| LangGraph has no TS equivalent | swarm | State machine design | MUST design custom |
| LangChain has no TS equivalent | swarm | LLM orchestration | MUST design custom |

### 10.2 Coordination Required

| Contract | Shared Between | Action Required | Deadline |
|----------|---------------|-----------------|----------|
| `defense_analytics` schema | VibeCheck + Swarm | Lock schema before Phase 3 | Phase 3 start |

### 10.3 Deprioritized Items

| Item | Reason | Phase |
|------|--------|-------|
| Angular.js legacy dashboard | No active ownership, deprioritized | Phase 10 |

---

## Plan Review

This plan was reviewed by `plan-document-reviewer` subagent. The Phase structure (Section 6) is intentional for this multi-phase refactor — each Phase contains sub-tasks that will be further broken into Red-Green-Refactor cycles during execution via the `subagent-driven-development` skill.

**Plan Status: APPROVED FOR EXECUTION**

---

## Execution Options

Per `writing-plans` SKILL.md §131-137:

### Option 1: Subagent-Driven (RECOMMENDED)

Dispatch fresh subagents per task for maximum parallelism:

```
Phase 1: Frontend scaffold completion
  → Dispatch subagent per sub-task (tsconfig, .env, globals.css, etc.)

Phase 2: Frontend TFD implementation
  → Dispatch subagent per feature slice

Phase 3: VibeCheck scaffolding + contract lock
  → Dispatch subagent for contract coordination
  → Dispatch subagent for Hono scaffold

Phase 4: Swarm state machine
  → Dispatch subagent for state machine design
  → Dispatch subagent per agent implementation

Phase 5: Integration testing
  → Dispatch subagent for cross-module integration

Phase 6: Optimization & hardening
  → Dispatch subagent for load testing
  → Dispatch subagent for security audit
```

### Option 2: Inline Execution

Execute tasks sequentially in this session with Ralph Wiggum checkpoints between iterations.

---

*Last updated: 2026-03-29*
