Good question — and very relevant since both use tree-sitter into a graph. Let me break down the gap:

---

## What VibeCheck's Graph Currently Does

Based on your scan pipeline:
- Stores code entities (functions, files, calls) from tree-sitter
- Traverses for N+1 detection
- Pattern propagation via Qdrant similarity

It's **vulnerability-focused** — the graph exists to find and propagate bug patterns.

---

## What codebase-memory-mcp Does Differently

### 1. Multi-Pass Indexing Pipeline
They run **6 distinct passes** instead of one:
```
structure → definitions → calls → HTTP links → config → tests
```
Your pipeline parses in one pass. The HTTP links pass is immediately relevant — it maps route handlers to functions, so you can trace `POST /api/users` → `createUser()` → `db.query()` and flag injection points at the **route level**, not just the function level.

**How to use it:** Add a dedicated HTTP route extraction pass that links Express/Hono route definitions to their handler chains in Neo4j. Then vulnerability reports can say "this SQL injection is reachable via `POST /api/login`" instead of just "found in `loginHandler()`".

---

### 2. Louvain Community Detection
They run community detection on the graph to find **clusters of tightly related code**. For vuln detection this is powerful — if one function in a community has a vulnerability, functions in the same community are high-probability candidates for the same class of bug.

**How to use it:** After finding a vulnerability, run Louvain on your Neo4j graph and check all functions in the same community. This replaces or augments your current Qdrant similarity search for pattern propagation — graph community is a stronger signal than vector similarity for structural bugs like N+1.

---

### 3. Config File Parsing as Graph Nodes
They index config files (`.env`, `package.json`, `docker-compose.yml`) as nodes linked to the code that consumes them.

**How to use it:** If you can see that `process.env.DATABASE_URL` is used directly in a raw query without sanitization, that's a misconfiguration vulnerability. Linking config nodes to their consumers in your graph makes this class of finding possible.

---

### 4. Test File Linking
They link test files to the functions they test as graph edges.

**How to use it:** Functions with **zero test coverage edges** in the graph are higher risk — flag those findings with elevated severity. Functions that are tested but still vulnerable are even more interesting — that's a gap in the test suite worth reporting.

---

### 5. Cross-File Type Resolution (LSP-style)
For call graphs, they resolve types across files — so if `UserService.create()` calls `db.query()` through an interface, they still trace the edge correctly.

**How to use it:** Your current N+1 detection likely misses ORM calls that go through abstraction layers. Proper cross-file type resolution would let you trace `repository.findAll()` → `TypeORM QueryBuilder` → actual SQL, catching N+1s that currently slip through.

---

## Priority Order for VibeCheck

| Feature | Impact on Vuln Detection | Effort |
|---|---|---|
| HTTP route → handler linking | High — route-level vuln attribution | Medium |
| Cross-file type resolution | High — catches abstraction-layer bugs | High |
| Community detection for propagation | Medium — better than Qdrant for structural bugs | Medium |
| Zero-test-coverage flagging | Medium — better severity scoring | Low |
| Config file nodes | Medium — misconfiguration class of vulns | Low |

Start with **HTTP route linking** and **zero-test-coverage flagging** — highest impact for lowest effort, and directly makes your reports more actionable for developers reading them.