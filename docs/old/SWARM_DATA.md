# Swarm Backend API Raw Data

Mission ID: `c2db1190-8c6a-4836-9ae7-7db79fbbf539`

---

## 1. Mission Details
**Endpoint:** `GET /swarm/c2db1190-8c6a-4836-9ae7-7db79fbbf539`

```json
{
  "mission_id": "c2db1190-8c6a-4836-9ae7-7db79fbbf539",
  "target": "http://localhost:8080",
  "objective": "Execute a comprehensive security audit including: 1) Map attack surface, 2) Test for SQL injection, XSS, IDOR, auth bypass, 3) Attempt token hijacking and session manipulation, 4) Hunt for sensitive data exposure",
  "status": "completed",
  "progress": 0,
  "max_iterations": 3,
  "findings_count": 74,
  "created_at": "2026-03-07T15:24:50.678263Z"
}
```

---

## 2. Agents
**Endpoint:** `GET /swarm/c2db1190-8c6a-4836-9ae7-7db79fbbf539/agents`

```json
[
  {"agent_id": "commander", "agent_name": "commander", "agent_team": "red", "status": "complete", "iter": "5", "task": "mission_complete"},
  {"agent_id": "alpha", "agent_name": "alpha", "agent_team": "red", "status": "complete", "iter": "5", "task": "mission_complete"},
  {"agent_id": "gamma", "agent_name": "gamma", "agent_team": "red", "status": "complete", "iter": "5", "task": "mission_complete"},
  {"agent_id": "critic", "agent_name": "critic", "agent_team": "red", "status": "complete", "iter": "5", "task": "mission_complete"}
]
```

---

## 3. Findings (first 10)
**Endpoint:** `GET /swarm/c2db1190-8c6a-4836-9ae7-7db79fbbf539/findings`

| id | title | severity | finding_type | confirmed |
|----|-------|----------|--------------|-----------|
| 879296e0-... | IDOR on http://localhost:8080/rest/basket/3 | medium | idor | true |
| f731d438-... | IDOR on http://localhost:8080/api/Users | medium | idor | true |
| e5c719aa-... | IDOR on http://localhost:8080/rest/basket/1 | medium | idor | true |
| 72b6e51b-... | IDOR on http://localhost:8080/rest/user/security-question | medium | idor | true |
| 7f84408f-... | IDOR on http://localhost:8080/rest/basket/5 | medium | idor | true |
| e9caf3c8-... | IDOR on http://localhost:8080/rest/basket/4 | medium | idor | true |
| 058df080-... | INFO_DISCLOSURE on http://localhost:8080/rest/languages | medium | info_disclosure | true |
| 742a2423-... | CLIENT_SIDE_BYPASS on http://localhost:8080/api/Challenges | low | client_side_bypass | true |
| aa243d28-... | INFO_DISCLOSURE on http://localhost:8080/api/Feedbacks | low | info_disclosure | true |

---

## 4. Timeline Events (all agents)
**Endpoint:** `GET /swarm/c2db1190-8c6a-4836-9ae7-7db79fbbf539/timeline-events?limit=15`

| agent | event_type | title | description |
|-------|------------|-------|-------------|
| commander | agent_complete | Mission completed — report generated | null |
| critic | critic_analysis | Critic: idor - ✗ | The exploit attempt did not succeed... |
| gamma | exploit_attempt | idor on http://localhost:8080/rest/basket/10 | Tool: curl, Exploit: idor |
| critic | critic_analysis | Critic: idor - ✗ | The exploit attempt was successful, but no data exposure... |
| gamma | exploit_attempt | idor on http://localhost:8080/rest/basket/99 | Tool: curl, Exploit: idor |
| critic | critic_analysis | Critic: auth_bypass - ✗ | The payload did not result in an authentication bypass... |
| gamma | exploit_attempt | auth_bypass on http://localhost:8080/admin | Tool: curl, Exploit: auth_bypass |
| gamma | exploit_attempt | idor on http://localhost:8080/rest/basket/3 | Tool: curl, Exploit: idor |
| gamma | exploit_attempt | idor on http://localhost:8080/rest/basket/1 | Tool: curl, Exploit: idor |
| gamma | exploit_attempt | idor on http://localhost:8080/api/Users | Tool: curl, Exploit: idor |

---

## 5. Agent-Specific Timeline Events

### Commander
**Endpoint:** `GET /swarm/c2db1190-8c6a-4836-9ae7-7db79fbbf539/timeline-events?agent=commander`

| event_type | title | description |
|------------|-------|-------------|
| agent_complete | Mission completed — report generated | null |
| task_assignment | Commander issued 2 tasks | We will start by performing reconnaissance... |
| agent_start | Mission started — Blue Team enrichment | null |

### Alpha Recon
**Endpoint:** `GET /swarm/c2db1190-8c6a-4836-9ae7-7db79fbbf539/timeline-events?agent=alpha`

**⚠️ ISSUE:** All titles are empty (e.g., "Recon: ", "Recon: ")

| event_type | title | target |
|------------|-------|--------|
| recon_finding | Recon: " | http://localhost:8080 |
| recon_finding | Recon:   | http://localhost:8080 |
| recon_finding | Recon:  { | http://localhost:8080 |

### Gamma Exploit
**Endpoint:** `GET /swarm/c2db1190-8c6a-4836-9ae7-7db79fbbf539/timeline-events?agent=gamma`

| event_type | title | description | success |
|------------|-------|-------------|---------|
| exploit_attempt | idor on http://localhost:8080/rest/basket/10 | Tool: curl, Exploit: idor | false |
| exploit_attempt | idor on http://localhost:8080/rest/basket/99 | Tool: curl, Exploit: idor | false |
| exploit_attempt | auth_bypass on http://localhost:8080/admin | Tool: curl, Exploit: auth_bypass | false |
| exploit_attempt | idor on http://localhost:8080/rest/basket/3 | Tool: curl, Exploit: idor | true |
| exploit_attempt | idor on http://localhost:8080/rest/basket/1 | Tool: curl, Exploit: idor | true |
| exploit_attempt | idor on http://localhost:8080/api/Users | Tool: curl, Exploit: idor | true |
| exploit_attempt | idor on http://localhost:8080/rest/basket/5 | Tool: curl, Exploit: idor | true |

### Critic
**Endpoint:** `GET /swarm/c2db1190-8c6a-4836-9ae7-7db79fbbf539/timeline-events?agent=critic`

| event_type | title | description | success |
|------------|-------|-------------|---------|
| critic_analysis | Critic: idor - ✗ | The exploit attempt did not succeed... | false |
| critic_analysis | Critic: idor - ✗ | The exploit attempt was successful, but no data exposure... | false |
| critic_analysis | Critic: auth_bypass - ✗ | The payload did not result in an authentication bypass... | false |
| critic_analysis | Critic: info_disclosure - ✓ | The exploit was successful... | true |
| critic_analysis | Critic: client_side_bypass - ✓ | The exploit was successful... | true |
| critic_analysis | Critic: info_disclosure - ✗ | 🚨 TOO LOUD - 500 Internal Server Error detected! | false |

---

## Data Mapping to UI Components

| UI Component | Endpoint Used |
|--------------|---------------|
| Header Stats | `/swarm/{id}` + `/swarm/{id}/findings` |
| Inspector (click node) | `/swarm/{id}/timeline-events?agent={agentName}` |
| Terminal (bottom-left) | `/swarm/{id}/timeline-events` |
| Findings Report | `/swarm/{id}/findings` |
| 3D Node Colors | `/swarm/{id}/agents` |

---

## Issues Found

1. **Alpha Recon** - Timeline events have empty titles ("Recon: ")
2. **Only 4 agents** in DB but UI expects 12 nodes
3. **Terminal empty** - Mission is completed, no live events (works during active mission)
