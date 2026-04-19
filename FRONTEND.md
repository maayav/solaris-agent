# Frontend Module Analysis Report

## Module: `frontend/`

---

## 1. Current Stack & Dependencies

### Core Framework
| Technology | Version | Notes |
|---|---|---|
| React | 19.x | Latest React |
| TypeScript | 5.x | Strict mode enabled |
| Vite | 6.x | Build tool |
| Tailwind CSS | 4.x | Via `@tailwindcss/vite` plugin |

### Routing
| Technology | Version | Notes |
|---|---|---|
| React Router | 7.x | Lazy-loaded routes |
| @types/react-router-dom | 5.x | **MISMATCH** — should be v7 types |

### State & Data Fetching
| Technology | Version | Notes |
|---|---|---|
| TanStack React Query | latest | **GENUINELY UNUSED** — listed in deps but no QueryClient provider in app; direct API calls only |
| Zustand | latest | **GENUINELY UNUSED** — listed in deps but no store created; React useState only |

### Forms & Validation
- React Hook Form + Zod — **GENUINELY UNUSED** — listed in deps but no form components use it

### UI Components
| Technology | Version | Notes |
|---|---|---|
| Shadcn/UI | — | **Not installed** |
| Tailwind UI | — | **Not used** |

### Animations
| Technology | Version | Notes |
|---|---|---|
| Framer Motion | 12.x | Primary animation library |
| Motion | 11.x | Also installed (redundant) |
| GSAP | — | **Not used** — target animation library |

### Data Visualization
| Technology | Version | Notes |
|---|---|---|
| Recharts | 2.x | Used for dashboard charts |

### Icons
| Technology | Version | Notes |
|---|---|---|
| Phosphor Icons | — | **GENUINELY UNUSED** — listed in deps but no Phosphor icon components found in codebase |

### Backend (Bundled)
| Technology | Version | Notes |
|---|---|---|
| Express | 4.x | **Will be replaced** by Hono/Bun |
| better-sqlite3 | 11.x | **HARDBLOCK** — native Node addon, **zero Bun support**, must be removed before any Bun migration can proceed |

### Real-time
| Technology | Version | Notes |
|---|---|---|
| @supabase/supabase-js | 2.x | Real-time chat persistence |

### AI/ML
| Technology | Version | Notes |
|---|---|---|
| @google/genai | latest | Google Generative AI integration |

### 3D
| Technology | Version | Notes |
|---|---|---|
| Three.js | 0.170+ | 3D capabilities |
| @types/three | latest | TypeScript types |

---

## 2. Processing Pipeline / Data Flow

### Route Architecture (5 Lazy-Loaded Routes)

```
App.tsx (Router)
├── /              → LandingPage    (lazy)
├── /dashboard     → DashboardPage  (lazy)
├── /pipeline      → PipelinePage   (lazy)
├── /chat          → ChatPage       (lazy)
└── /swarm         → SwarmPage      (lazy)
```

### Data Flow

```
User Interaction
       ↓
Page Component (React Router)
       ↓
API Call (api.ts → localhost:8000)
       ↓
Express Backend (bundled in frontend/)  ← Must be excised first
       ↓
External Services (Supabase, etc.)
```

### API Layer (`api.ts`)
- REST client targeting `localhost:8000`
- Covers: agents, scanner, reports, swarm missions
- Axios singleton pattern (not yet implemented — direct fetch)

### Real-time Layer (`supabase.ts`)
- Supabase client for chat persistence
- Real-time subscriptions for chat updates

### Agent Config (`agent-config.ts`)
- 14 agent types for red/blue team operations
- Configuration for different agent personas

---

## 3. Architecture

### Directory Structure

```
frontend/src/
├── main.tsx              # Entry point + ThemeProvider
├── App.tsx               # React Router (5 routes, lazy-loaded)
├── api.ts                # REST API client → localhost:8000
├── supabase.ts           # Supabase real-time client
├── agent-config.ts       # 14 agent type definitions
├── components/           # Shared UI components (flat structure)
│   ├── Navbar.tsx
│   ├── Footer.tsx
│   ├── ThemeProvider.tsx
│   ├── Scanner.tsx
│   ├── ChatInterface.tsx
│   ├── PipelineOverview.tsx
│   ├── VulnerabilityPanel.tsx
│   ├── ChatBubble.tsx
│   ├── ModelSelector.tsx
│   ├── PromptKeywordAnalyzer.tsx
│   ├── FileDiff.tsx
│   ├── FileViewer.tsx
│   ├── CommitInput.tsx
│   ├── DiffViewer.tsx
│   └── ...
├── pages/                # Route pages
│   ├── LandingPage.tsx
│   ├── DashboardPage.tsx
│   ├── PipelinePage.tsx
│   ├── ChatPage.tsx
│   └── SwarmPage.tsx
└── index.css             # Tailwind + custom styles
```

### Layers

| Layer | Responsibility | Status |
|---|---|---|
| **Routing** | React Router v7, lazy-loaded pages | ⚠️ Wrong types (v5) |
| **Pages** | Route-level components | Flat structure |
| **Components** | Reusable UI | Flat structure, no feature slicing |
| **API** | REST calls to backend | Direct fetch, no Axios singleton |
| **Real-time** | Supabase chat | Present but not fully integrated |

### Key Files

| File | Lines | Purpose |
|---|---|---|
| `App.tsx` | ~50 | Router with 5 lazy routes |
| `api.ts` | ~200 | REST API layer (14 agent types, scanner, reports, swarm) |
| `supabase.ts` | ~50 | Real-time chat client |
| `agent-config.ts` | ~100 | 14 agent type definitions |
| `main.tsx` | ~30 | Entry point with ThemeProvider |

---

## 4. Refactoring Notes: TypeScript + Hono + Bun

### ✅ Already Aligned with Target

| Feature | Current | Target | Action |
|---|---|---|---|
| Language | TypeScript 5.x | TypeScript | **No change needed** |
| Build tool | Vite 6 | Vite | **No change needed** |
| CSS framework | Tailwind 4 | Tailwind 4 | **No change needed** |
| Routing | React Router 7 | React Router 7 | **Fix types** |

### 🔄 Needs Replacement

| Current | Target | Replacement Strategy |
|---|---|---|
| Express (bundled) | Hono | Remove Express entirely, use Hono for any SSR/API |
| better-sqlite3 | Bun native | **REMOVE FIRST** — hard block on Bun migration; zero Bun compatibility |
| Framer Motion + Motion | GSAP | Remove both, install GSAP |
| Direct fetch API | Axios singleton | Create `lib/api.ts` Axios singleton with interceptors |
| No state management | Zustand | Add Zustand for UI state |
| No server state cache | TanStack React Query | Enable for all server data |
| No form handling | React Hook Form + Zod | Add for all form inputs |
| No component library | Shadcn/UI | Install and replace native components |
| Flat component structure | Feature-Sliced Architecture | Restructure into `features/`, `shared/`, `app/` |
| No Container/Presenter | Container/Presenter | Extract logic from page components |
| No compound components | Compound components | Build DataTable, etc. as compound |
| No theming system | CSS variables | Add `--color-*` CSS variables for theming |

### ⚠️ Problematic Dependencies

| Dependency | Problem | Solution |
|---|---|---|
| `better-sqlite3` | **HARDBLOCK** — Native Node addon, zero Bun support | **Must remove before any Bun work begins** — replace with `bun:sqlite` post-migration |
| `@types/react-router-dom` v5 | Type mismatch with React Router v7 | Remove wrong types, use built-in v7 types |
| `express` | Not needed in Bun runtime | Remove entirely |
| `framer-motion` + `motion` | Redundant | Keep `motion` only, migrate to GSAP |

### ⚠️ Behavioral Changes (Require Regression Testing)

| Change | Risk | Notes |
|---|---|---|
| Framer Motion → **GSAP** | **HIGH** | GSAP has a completely different mental model from Framer Motion. Framer Motion is declarative/prop-driven; GSAP is timeline/sequence-driven. Every animated component will need rewriting, not porting. Budget significant QA time for visual regression testing across all pages. |

### ⚠️ Structural Complexity Warnings

| Pattern | Risk | Notes |
|---|---|---|
| **Feature-Sliced Architecture** | **HIGH complexity** | FSA is a large-scale structural refactor, not a library add. It requires defining `shared/`, `entities/`, `features/`, `widgets/`, `pages/` slices with strict import rules. Wrong early切割 = expensive rework. **Escalation rule**: Start with Container/Presenter extraction during Phase 5. Once containers stabilize (logic extracted, props contracted), promote to FSA slice boundaries. Doing full FSA before containers exist means reorganizing twice. For this codebase, FSA is a natural fit because features map directly to existing pages (dashboard, pipeline, chat, swarm) — use that alignment as your slice boundaries. |

### 🔲 Gaps to Fill

| Gap | Current State | Target State |
|---|---|---|
| Theming | No CSS variables | Full `--color-*` system |
| Component library | None | Shadcn/UI |
| Form validation | Uncontrolled inputs | React Hook Form + Zod |
| Server state | Direct fetch | TanStack React Query |
| UI state | React state | Zustand |
| Animations | Framer Motion | GSAP |
| Architecture | Flat | Feature-Sliced + Container/Presenter |
| Icons | Mixed | Phosphor Icons exclusively |
| Data viz | Recharts | Recharts (keep) |

### 🚨 Testing Gap Warning

The frontend has **no tests whatsoever** (no Jest, no Vitest, no Playwright, no RTL tests). Before undertaking this refactor, establish a test baseline:
1. Add Vitest + React Testing Library for component tests
2. Add Playwright for E2E smoke tests on key flows (login, dashboard, pipeline)
3. GSAP animations especially need visual regression tests (consider Playwright + screenshotdiff or GSAP's own velocity testing)
4. Without tests, every refactor phase risks silent behavioral regressions

### Migration Order

1. **Phase 1**: Fix types, remove `better-sqlite3` (HARDBLOCK), remove Express
2. **Phase 2**: Add Axios singleton, TanStack Query, Zustand
3. **Phase 3**: Add React Hook Form + Zod, Shadcn/UI
4. **Phase 4**: Add GSAP, replace Framer Motion — **allocate regression testing budget**
5. **Phase 5**: Restructure to Feature-Sliced Architecture — **consider Container/Presenter first**
6. **Phase 6**: Add Container/Presenter pattern, compound components
