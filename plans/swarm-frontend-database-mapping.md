# Swarm Page ↔ Database Schema Mapping

This document shows how the Swarm page visualization maps to the database tables.

## Swarm Page Components

The Swarm page (`frontend/src/pages/Swarm.tsx`) visualizes:
1. **12 Network Nodes** (agents with status, logs, positions)
2. **Connection Edges** (static in frontend, dynamic status via agents)
3. **Timeline/Logs** (real-time agent actions)
4. **Findings Panel** (discovered vulnerabilities)

---

## Database to Frontend Mapping

### 1. Network Nodes (12 Agents)

The 12 nodes in the 3D visualization map to `swarm_agent_states`:

| Node ID (Frontend) | Display Name | Team | DB Table | DB Fields Used |
|-------------------|--------------|------|----------|----------------|
| `purple-cmd` | Purple Commander | purple | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `kg-agent` | Knowledge Graph | blue | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `sast-agent` | SAST Semgrep | blue | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `llm-verify` | LLM Verifier | blue | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `traffic-mon` | Traffic Monitor | blue2 | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `sig-detect` | Signature Detector | blue2 | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `redis-pub` | Redis Bridge | blue2 | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `red-cmd` | Red Commander | red | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `alpha-recon` | Alpha Recon | red | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `gamma-exploit` | Gamma Exploit | red | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `critic` | Critic Agent | red | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |
| `sandbox` | Sandbox Container | sand | `swarm_agent_states` | `status`, `iter`, `task`, `recent_logs` |

**Query to get all agent states for a mission:**
```sql
SELECT * FROM swarm_agent_states 
WHERE mission_id = 'your-mission-uuid'
ORDER BY agent_team, agent_name;
```

---

### 2. Agent Logs/Timeline

The logs panel in each agent's details maps to `swarm_agent_events`:

**Frontend Data Structure:**
```typescript
interface AgentLog {
  t: string;  // timestamp
  k: string;  // kind: 'info', 'action', 'warn', 'error', 'cmd', 'success'
  m: string;  // message
}
```

**Database Mapping:**
| Frontend Field | DB Table | DB Column |
|---------------|----------|-----------|
| `t` (timestamp) | `swarm_agent_events` | `created_at` |
| `k` (kind) | `swarm_agent_events` | `event_type` |
| `m` (message) | `swarm_agent_events` | `message` |

**Query to get logs for a specific agent:**
```sql
SELECT created_at, event_type, message, payload
FROM swarm_agent_events 
WHERE mission_id = 'your-mission-uuid' 
  AND agent_id = 'alpha-recon'
ORDER BY created_at DESC
LIMIT 50;
```

---

### 3. Agent-to-Agent Communications

A2A messages are stored in `swarm_agent_events` with `event_type = 'action'`:

**Example Events:**
| Event Type | Description | Example Message |
|-----------|-------------|-----------------|
| `action` | Agent action taken | "Dispatching Alpha Recon: nmap + service fingerprint" |
| `info` | Informational log | "Mission b6dda26e initialized" |
| `warning` | Warning/alert | "Blue intel: HIGH severity /api/login (SQLi)" |
| `error` | Error occurred | "BLOCKED — FORBIDDEN endpoint (Blue HIGH)" |
| `cmd` | Command executed | "nmap -sV -p 1-65535 localhost" |
| `success` | Successful operation | "nmap: 3 services" |

**Query to get all A2A communications:**
```sql
SELECT agent_name, event_type, message, created_at
FROM swarm_agent_events 
WHERE mission_id = 'your-mission-uuid'
  AND event_type IN ('action', 'info')
ORDER BY created_at DESC;
```

---

### 4. Findings/Vulnerabilities Panel

The findings panel maps to `swarm_findings`:

**Frontend Data Structure:**
```typescript
interface Finding {
  sev: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  type: string;      // 'SQLi', 'XSS', 'IDOR', 'RCE', etc.
  src: string;       // 'SAST', 'DAST', 'RECON', 'EXPLOIT'
  confirmed: boolean;
  agent: string;     // 'sast / gamma', 'alpha-recon', etc.
  cve: string;       // 'CVE-2022-2587' or ''
}
```

**Database Mapping:**
| Frontend Field | DB Table | DB Column |
|---------------|----------|-----------|
| `sev` | `swarm_findings` | `severity` |
| `title` | `swarm_findings` | `title` |
| `type` | `swarm_findings` | `finding_type` |
| `src` | `swarm_findings` | `source` |
| `confirmed` | `swarm_findings` | `confirmed` |
| `agent` | `swarm_findings` | `agent_name` |
| `cve` | `swarm_findings` | `cve_id` |

**Query to get all findings for a mission:**
```sql
SELECT 
  severity as sev,
  title,
  finding_type as type,
  source as src,
  confirmed,
  agent_name as agent,
  cve_id as cve
FROM swarm_findings 
WHERE mission_id = 'your-mission-uuid'
ORDER BY 
  CASE severity 
    WHEN 'critical' THEN 1 
    WHEN 'high' THEN 2 
    WHEN 'medium' THEN 3 
    WHEN 'low' THEN 4 
  END;
```

---

### 5. Sandbox Details

The Sandbox Container (`sandbox` node) status is stored in `swarm_agent_states`:

**Stored Information:**
- Container status (running, stopped, error)
- Current commands being executed
- Tool outputs (nmap, curl, etc.)

**Query to get sandbox status:**
```sql
SELECT status, iter, task, recent_logs
FROM swarm_agent_states 
WHERE mission_id = 'your-mission-uuid' 
  AND agent_id = 'sandbox';
```

---

### 6. Mission Progress

The overall mission progress bar and status come from `swarm_missions`:

**Frontend Data:**
- Mission status (pending, running, completed, failed)
- Progress percentage (0-100)
- Current phase (planning, recon, exploitation, report, complete)
- Iteration counter (e.g., "ITERATION 2/3")

**Database Mapping:**
| Frontend Display | DB Table | DB Column |
|-----------------|----------|-----------|
| Status badge | `swarm_missions` | `status` |
| Progress bar | `swarm_missions` | `progress` |
| Phase indicator | `swarm_missions` | `current_phase` |
| Iteration | `swarm_missions` | `iteration` / `max_iterations` |

**Query to get mission status:**
```sql
SELECT 
  status,
  progress,
  current_phase,
  iteration,
  max_iterations,
  target,
  objective
FROM swarm_missions 
WHERE id = 'your-mission-uuid';
```

---

## Real-time Updates via Supabase Realtime

All tables have realtime enabled for live frontend updates:

```sql
-- Tables with realtime enabled
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_missions;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_agent_events;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_findings;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_agent_states;
```

**Frontend subscribes to changes:**
- `swarm_missions` → Mission status/progress updates
- `swarm_agent_states` → Agent status changes
- `swarm_agent_events` → New log entries (INSERT only)
- `swarm_findings` → New vulnerabilities discovered

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        SWARM PAGE                               │
├─────────────────────────────────────────────────────────────────┤
│  3D Network Graph (12 nodes)                                    │
│  ├─ Node positions: Static in frontend                          │
│  ├─ Node status: From swarm_agent_states.status                 │
│  ├─ Node logs: From swarm_agent_states.recent_logs              │
│  └─ Node task: From swarm_agent_states.task                     │
│                                                                 │
│  Timeline/Logs Panel                                            │
│  └─ Real-time logs: From swarm_agent_events (INSERT)            │
│                                                                 │
│  Findings Panel                                                 │
│  └─ Vulnerabilities: From swarm_findings                        │
│                                                                 │
│  Mission Progress Bar                                           │
│  └─ Progress/status: From swarm_missions                        │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Supabase Realtime
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE DATABASE                          │
├─────────────────────────────────────────────────────────────────┤
│  swarm_missions        → Mission config & status                │
│  swarm_agent_states    → Current status of each agent           │
│  swarm_agent_events    → Logs, actions, communications          │
│  swarm_findings        → Discovered vulnerabilities             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Example: Full Mission Query

To get everything for a mission at once:

```sql
-- Mission overview
SELECT * FROM swarm_missions WHERE id = 'mission-uuid';

-- All agent states
SELECT * FROM swarm_agent_states WHERE mission_id = 'mission-uuid';

-- Recent events (last 100)
SELECT * FROM swarm_agent_events 
WHERE mission_id = 'mission-uuid' 
ORDER BY created_at DESC 
LIMIT 100;

-- All findings
SELECT * FROM swarm_findings 
WHERE mission_id = 'mission-uuid' 
ORDER BY severity;
```
