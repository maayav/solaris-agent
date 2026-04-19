That's a significant scope expansion — you're describing two distinct products in one:

***

## Two Products, One Platform

| Mode | Name | What it does |
|---|---|---|
| 🔴 **Red Team Mode** | VibeCheck Security | Finds exploitable vulnerabilities, attempts exploitation |
| 🔵 **Code Review Mode** | VibeCheck Quality | Finds tech debt, bad patterns, scalability issues, outdated deps |

Both can share the same parser, graph, and LLM pipeline. The detectors and output differ.

***

## What Code Review Mode Catches

### Static / Structural (Free — Tree-Sitter already does this)
- Hardcoded strings/secrets (already in Semgrep)
- Functions over 100 lines → unmaintainable
- Deeply nested loops (3+ levels) → complexity smell
- Duplicate code blocks across files
- `TODO`/`FIXME`/`HACK` comment density
- Dead code (imported but never called)

### Dependency Analysis (npm/pip audit)
```bash
npm audit --json          # known CVEs in dependencies
npm outdated --json       # outdated packages with latest versions
npx depcheck              # unused dependencies
```
- Flags `express 4.x` → suggest migrating to `4.21+` or Fastify
- Flags `moment.js` → suggest `date-fns` or `dayjs` (smaller, maintained)
- Flags `lodash` → suggest native ES6 equivalents
- Flags EOL Node.js versions in `.nvmrc` or `package.json engines`

### Pattern-Based (Semgrep custom rules)
```yaml
# Anti-patterns to detect
- Callback hell (nested callbacks 3+ deep) → suggest async/await
- var usage in modern JS → suggest const/let
- console.log left in production code
- Synchronous fs calls in Express routes → blocks event loop
- Missing error handling on async functions
- Raw SQL strings → suggest ORM
- God objects (classes with 20+ methods)
```

### Scalability Issues (Graph query on FalkorDB)
```cypher
// Find endpoints with no rate limiting
MATCH (e:Endpoint)
WHERE NOT EXISTS {
  MATCH (e)-[:PROTECTED_BY]->(:Middleware {type: 'rateLimit'})
}
RETURN e

// Find DB queries in loops (already have this)
MATCH (l:Loop)-[:CONTAINS]->(o:ORMCall)
RETURN l, o

// Find endpoints with no auth middleware
MATCH (e:Endpoint)
WHERE e.method IN ['POST','PUT','DELETE','PATCH']
AND NOT EXISTS {
  MATCH (e)-[:PROTECTED_BY]->(:Middleware {type: 'auth'})
}
RETURN e
```

### LLM-Powered Review
- Feed function to Qwen2.5-coder, ask: *"Rate maintainability 1-10, identify issues, suggest improvements"*
- Architectural smell detection: circular dependencies, tight coupling
- Better library suggestions based on what's already in `package.json`

***

## Revised Architecture

```
Scan Input (repo URL / ZIP)
         │
         ▼
┌─────────────────────────┐
│     Scan Worker         │
│                         │
│  Tree-Sitter Parser     │ ← shared
│  FalkorDB Graph         │ ← shared
│  Semantic Lifter        │ ← shared
│         │               │
│    ┌────┴────┐          │
│    ▼         ▼          │
│ Security   Quality      │
│ Pipeline   Pipeline     │
│    │         │          │
│  Semgrep  npm audit     │
│  N+1      dep check     │
│  Taint    complexity    │
│  Analysis anti-pattern  │
│    │         │          │
│    └────┬────┘          │
│         ▼               │
│   LLM Verification      │ ← shared
│   + Qdrant Patterns     │ ← shared
└─────────────────────────┘
         │
         ▼
   Supabase Storage
   (security_vulns + quality_issues tables)
         │
         ▼
   Frontend Dashboard
```

***

## Impact on Timeline

| Week | Original Plan | Revised Plan |
|---|---|---|
| 4 | Red team agents | Red team agents + Quality pipeline foundation |
| 5 | Frontend | Frontend (both modes) |
| 6 | — | Quality LLM reviewer + dep analysis |

The quality pipeline is **significantly easier** than the red team agents — no sandboxed exploitation, just detection + LLM suggestions. You can add it in Week 4 alongside the agents without slipping the timeline, since it reuses all the existing infrastructure.

***

## Supabase Schema Addition

```sql
create table quality_issues (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid references scans(id),
  category text,           -- 'maintainability' | 'scalability' | 'outdated_dep' | 'anti_pattern' | 'complexity'
  severity text,           -- 'critical' | 'high' | 'medium' | 'low' | 'info'
  file_path text,
  line_start int,
  line_end int,
  title text,
  description text,
  suggestion text,         -- "Replace moment.js with date-fns"
  effort text,             -- 'trivial' | 'small' | 'medium' | 'large'
  code_snippet text,
  detector text,           -- 'semgrep' | 'npm_audit' | 'tree_sitter' | 'llm'
  confirmed boolean default true,  -- quality issues don't need LLM confirmation
  created_at timestamptz default now()
);
```

Add this to the Week 4 Kilo prompt and it stays on schedule.