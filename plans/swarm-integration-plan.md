# Swarm Module Integration Plan

## Overview

This plan details the integration of the `swarm module` (Red Team + Blue Team security platform) into the existing VibeCheck codebase. The integration will enable real-time swarm missions through the existing FastAPI backend and React frontend.

## Architecture

### Current System
```
┌─────────────────────────────────────────────────────────────────┐
│                    Existing VibeCheck System                     │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React/TS)  ←───API───→  FastAPI Backend              │
│     ├─ Swarm.tsx                   ├─ /scan routes              │
│     ├─ Dashboard.tsx               ├─ /report routes            │
│     └─ Pipeline.tsx                └─ /chat routes              │
│                                        ├─ Supabase Client       │
│                                        ├─ Redis Bus             │
│                                        ├─ FalkorDB              │
│                                        └─ Qdrant                │
└─────────────────────────────────────────────────────────────────┘
```

### Target Integrated System
```
┌─────────────────────────────────────────────────────────────────┐
│                    Integrated VibeCheck System                   │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React/TS)  ←───API───→  FastAPI Backend              │
│     ├─ Swarm.tsx (Live)            ├─ /scan routes              │
│     │   └─ WebSocket                    ├─ /report routes       │
│     ├─ Dashboard.tsx                    ├─ /chat routes         │
│     └─ Pipeline.tsx                     ├─ /swarm routes [NEW]  │
│                                             ├─ /swarm/trigger   │
│                                             ├─ /swarm/{id}      │
│                                             └─ /swarm/ws/{id}   │
│                                         ├─ Swarm Service        │
│                                         │   ├─ Mission Manager  │
│                                         │   ├─ Red Team Agents  │
│                                         │   └─ Blue Team Agent  │
│                                         ├─ Supabase Client      │
│                                         ├─ Redis Bus            │
│                                         ├─ FalkorDB             │
│                                         └─ Qdrant               │
└─────────────────────────────────────────────────────────────────┘
```

## Swarm Module Components to Integrate

### Red Team Agents (from `swarm module/Red_team/`)
1. **Commander Agent** (`agents/commander.py`) - Orchestrates the mission
2. **Alpha Recon** (`agents/alpha_recon.py`) - Port scanning, reconnaissance
3. **Gamma Exploit** (`agents/gamma_exploit.py`) - Exploit execution
4. **Critic Agent** (`agents/critic_agent.py`) - Validation and review
5. **Report Generator** (`agents/report_generator.py`) - Mission reports
6. **LangGraph State Machine** (`agents/graph.py`)
7. **Tools** (`agents/tools/`)
   - nmap_tool.py
   - curl_tool.py
   - nuclei_tool.py
   - python_exec.py
   - web_search_tool.py

### Blue Team (from `swarm module/Blue_team/`)
1. **Solaris Agent** - Defensive monitoring
2. **Traffic Monitor** - Real-time request analysis
3. **Signature Detector** - Attack pattern detection

### Shared Infrastructure
1. **Redis Bus** - A2A messaging (`core/redis_bus.py`)
2. **Sandbox** - Docker container for tool execution
3. **LLM Clients** - OpenRouter + Ollama

## Database Schema Additions

### New Tables

```sql
-- ===========================================
-- Swarm Missions Table
-- ===========================================
CREATE TABLE IF NOT EXISTS swarm_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scan_queue(id) ON DELETE CASCADE,
    
    -- Mission configuration
    target TEXT NOT NULL,
    objective TEXT NOT NULL,
    mode TEXT CHECK (mode IN ('live', 'static')),
    max_iterations INTEGER DEFAULT 3,
    
    -- Mission status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    current_phase TEXT, -- 'recon', 'exploitation', 'report', 'complete'
    iteration INTEGER DEFAULT 0,
    
    -- Results
    findings JSONB DEFAULT '[]',
    report_path TEXT,
    report_json JSONB,
    
    -- Error handling
    error_message TEXT,
    
    -- Timestamps
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swarm_missions_scan_id ON swarm_missions(scan_id);
CREATE INDEX IF NOT EXISTS idx_swarm_missions_status ON swarm_missions(status);

-- ===========================================
-- Swarm Agent Events Table
-- ===========================================
CREATE TABLE IF NOT EXISTS swarm_agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id) ON DELETE CASCADE,
    
    -- Agent information
    agent_name TEXT NOT NULL, -- 'commander', 'alpha', 'gamma', 'critic', 'blue-defensive'
    agent_team TEXT NOT NULL CHECK (agent_team IN ('red', 'blue', 'purple')),
    
    -- Event details
    event_type TEXT NOT NULL, -- 'log', 'action', 'warning', 'error', 'success'
    message TEXT NOT NULL,
    payload JSONB, -- Additional structured data
    
    -- Context
    iteration INTEGER,
    phase TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swarm_events_mission_id ON swarm_agent_events(mission_id);
CREATE INDEX IF NOT EXISTS idx_swarm_events_agent ON swarm_agent_events(agent_name);
CREATE INDEX IF NOT EXISTS idx_swarm_events_created ON swarm_agent_events(created_at);

-- ===========================================
-- Swarm Findings Table
-- ===========================================
CREATE TABLE IF NOT EXISTS swarm_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id) ON DELETE CASCADE,
    
    -- Finding details
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    finding_type TEXT, -- 'SQLi', 'XSS', 'IDOR', 'RCE', etc.
    source TEXT, -- 'SAST', 'DAST', 'RECON', 'EXPLOIT'
    
    -- Location
    target TEXT,
    endpoint TEXT,
    
    -- Status
    confirmed BOOLEAN DEFAULT FALSE,
    agent_name TEXT, -- Which agent found this
    
    -- Evidence
    evidence JSONB,
    cve_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swarm_findings_mission_id ON swarm_findings(mission_id);
CREATE INDEX IF NOT EXISTS idx_swarm_findings_severity ON swarm_findings(severity);
```

## API Endpoints

### New Routes (`vibecheck/api/routes/swarm.py`)

```python
# POST /swarm/trigger
# Trigger a new swarm mission
{
    "target": "http://localhost:3000",
    "objective": "Comprehensive security audit...",
    "mode": "live",  # or "static" for repo scanning
    "max_iterations": 3,
    "scan_id": "optional-existing-scan-id"
}

# GET /swarm/{mission_id}
# Get mission status and details
{
    "mission_id": "uuid",
    "status": "running",
    "progress": 45,
    "current_phase": "exploitation",
    "iteration": 2,
    "target": "http://localhost:3000",
    "findings_count": 5,
    "agents": [...],
    "created_at": "...",
    "started_at": "..."
}

# GET /swarm/{mission_id}/events
# Get agent events/logs
{
    "events": [
        {
            "agent_name": "alpha-recon",
            "agent_team": "red",
            "event_type": "action",
            "message": "nmap scan completed",
            "timestamp": "..."
        }
    ]
}

# GET /swarm/{mission_id}/findings
# Get discovered findings
{
    "findings": [...]
}

# WebSocket /swarm/ws/{mission_id}
# Real-time mission updates
```

## File Structure Changes

```
vibecheck/
├── api/
│   ├── main.py                    # Add swarm router
│   └── routes/
│       └── swarm.py               # [NEW] Swarm endpoints
├── core/
│   └── swarm_mission_service.py   # [NEW] Mission orchestration
├── agents/
│   └── swarm/                     # [NEW] Integrated swarm agents
│       ├── __init__.py
│       ├── commander.py           # From Red_team/agents/
│       ├── alpha_recon.py
│       ├── gamma_exploit.py
│       ├── critic_agent.py
│       ├── report_generator.py
│       ├── graph.py
│       ├── state.py
│       ├── schemas.py
│       ├── tools/
│       │   ├── __init__.py
│       │   ├── registry.py
│       │   ├── nmap_tool.py
│       │   ├── curl_tool.py
│       │   ├── nuclei_tool.py
│       │   ├── python_exec.py
│       │   └── web_search_tool.py
│       └── a2a/
│           ├── __init__.py
│           ├── messages.py
│           └── blackboard.py
├── migrations/
│   └── 004_add_swarm_tables.sql   # [NEW] Database migrations
└── sandbox/                       # [NEW] From Red_team/sandbox/
    ├── __init__.py
    ├── sandbox_manager.py
    └── Dockerfile.sandbox

frontend/src/
├── lib/
│   └── api.ts                     # Add swarm API functions
├── types/
│   └── index.ts                   # Add swarm types
└── pages/
    └── Swarm.tsx                  # Update to use real data
```

## Implementation Phases

### Phase 1: Database Layer
- Create migration file `004_add_swarm_tables.sql`
- Update Supabase client with swarm methods

### Phase 2: Backend Core
- Copy Red Team agents to `vibecheck/agents/swarm/`
- Adapt imports and integrate with existing core modules
- Create `swarm_mission_service.py` for mission management
- Add sandbox manager

### Phase 3: API Layer
- Create `vibecheck/api/routes/swarm.py`
- Implement REST endpoints
- Implement WebSocket endpoint for real-time updates
- Register routes in main.py

### Phase 4: Frontend Integration
- Add swarm API functions to `api.ts`
- Add swarm types to `index.ts`
- Update `Swarm.tsx` to connect to WebSocket and fetch real data

### Phase 5: Testing
- Test mission trigger
- Test agent execution
- Test WebSocket updates
- Test Supabase persistence
- Test end-to-end flow

## Key Integration Points

### 1. Redis Bus Integration
The existing Redis bus in `vibecheck/core/redis_bus.py` needs to support:
- `a2a_messages` stream (agent-to-agent)
- `defense_analytics` stream (Blue Team → Red Team)
- `red_team_events` stream (mission events)

### 2. Supabase Integration
New methods in `vibecheck/core/supabase_client.py`:
- `create_swarm_mission()`
- `update_swarm_mission()`
- `create_swarm_event()`
- `create_swarm_finding()`
- `get_swarm_mission()`
- `list_swarm_missions()`

### 3. WebSocket Manager
New `vibecheck/core/websocket_manager.py` for broadcasting mission updates to frontend clients.

## Configuration Updates

Add to `.env.example`:
```env
# Swarm Module Configuration
SWARM_REDIS_URL=redis://localhost:6381
SWARM_MAX_ITERATIONS=3
SWARM_SANDBOX_ENABLED=true
SWARM_SANDBOX_IMAGE=vibecheck-sandbox
```

## Migration Strategy

1. **Copy and Adapt**: Copy Red Team agents from swarm module, adapt imports
2. **Gradual Integration**: Start with API endpoints returning mock data
3. **Live Testing**: Enable real agent execution in development
4. **Production Ready**: Add safeguards, rate limiting, and monitoring

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Import conflicts between swarm and existing code | Use explicit imports, avoid `from x import *` |
| Redis namespace collision | Use prefixed keys: `swarm:a2a_messages` |
| Sandbox security | Run in isolated Docker with limited privileges |
| LLM API rate limits | Implement caching and backoff strategies |
| Database bloat from events | Implement event retention policy (auto-delete after 30 days) |

## Success Criteria

- [ ] Can trigger a swarm mission via API
- [ ] Mission status persists in Supabase
- [ ] Agent events stream to frontend via WebSocket
- [ ] Frontend visualization updates in real-time
- [ ] Mission reports are generated and stored
- [ ] Findings are linked to parent scan (if applicable)
