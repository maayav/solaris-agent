# Swarm Module Database Schema

## Migration: 004_add_swarm_tables.sql

This SQL migration creates the database schema for the swarm module integration.

### Tables

#### 1. swarm_missions
Stores swarm mission configuration and status.

```sql
CREATE TABLE IF NOT EXISTS swarm_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scan_queue(id) ON DELETE SET NULL,
    
    -- Mission configuration
    target TEXT NOT NULL,
    objective TEXT NOT NULL DEFAULT 'Execute a comprehensive security audit including: 1) Map attack surface, 2) Test for SQL injection, XSS, IDOR, auth bypass, 3) Attempt token hijacking and session manipulation, 4) Hunt for sensitive data exposure',
    mode TEXT CHECK (mode IN ('live', 'static')),
    max_iterations INTEGER DEFAULT 3,
    
    -- Mission status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    current_phase TEXT CHECK (current_phase IN ('planning', 'recon', 'exploitation', 'report', 'complete')),
    iteration INTEGER DEFAULT 0,
    
    -- Results
    findings JSONB DEFAULT '[]'::jsonb,
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

CREATE INDEX idx_swarm_missions_scan_id ON swarm_missions(scan_id);
CREATE INDEX idx_swarm_missions_status ON swarm_missions(status);
CREATE INDEX idx_swarm_missions_created_at ON swarm_missions(created_at DESC);
```

#### 2. swarm_agent_events
Stores real-time agent logs and events.

```sql
CREATE TABLE IF NOT EXISTS swarm_agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id) ON DELETE CASCADE,
    
    -- Agent information
    agent_name TEXT NOT NULL,
    agent_team TEXT NOT NULL CHECK (agent_team IN ('red', 'blue', 'purple', 'blue2', 'sand')),
    
    -- Event details
    event_type TEXT NOT NULL CHECK (event_type IN ('log', 'action', 'warning', 'error', 'success', 'info', 'cmd')),
    message TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    
    -- Context
    iteration INTEGER,
    phase TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_swarm_events_mission_id ON swarm_agent_events(mission_id);
CREATE INDEX idx_swarm_events_agent ON swarm_agent_events(agent_name);
CREATE INDEX idx_swarm_events_type ON swarm_agent_events(event_type);
CREATE INDEX idx_swarm_events_created ON swarm_agent_events(created_at DESC);
```

#### 3. swarm_findings
Stores vulnerabilities discovered by swarm agents.

```sql
CREATE TABLE IF NOT EXISTS swarm_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id) ON DELETE CASCADE,
    
    -- Finding details
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    finding_type TEXT,
    source TEXT,
    
    -- Location
    target TEXT,
    endpoint TEXT,
    file_path TEXT,
    line_start INTEGER,
    line_end INTEGER,
    
    -- Status
    confirmed BOOLEAN DEFAULT FALSE,
    agent_name TEXT,
    
    -- Evidence
    evidence JSONB DEFAULT '{}'::jsonb,
    cve_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_swarm_findings_mission_id ON swarm_findings(mission_id);
CREATE INDEX idx_swarm_findings_severity ON swarm_findings(severity);
CREATE INDEX idx_swarm_findings_type ON swarm_findings(finding_type);
CREATE INDEX idx_swarm_findings_confirmed ON swarm_findings(confirmed);
```

#### 4. swarm_agent_states
Stores current state of each agent in a mission.

```sql
CREATE TABLE IF NOT EXISTS swarm_agent_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id) ON DELETE CASCADE,
    
    -- Agent identification
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    agent_team TEXT NOT NULL CHECK (agent_team IN ('red', 'blue', 'purple', 'blue2', 'sand')),
    
    -- Status
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'complete', 'error', 'reviewing')),
    iter TEXT,
    task TEXT,
    
    -- Logs
    recent_logs JSONB DEFAULT '[]'::jsonb,
    
    -- Timestamps
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(mission_id, agent_id)
);

CREATE INDEX idx_swarm_agent_states_mission_id ON swarm_agent_states(mission_id);
CREATE INDEX idx_swarm_agent_states_agent ON swarm_agent_states(agent_id);
CREATE INDEX idx_swarm_agent_states_status ON swarm_agent_states(status);
```

### Triggers

```sql
-- Update trigger for swarm_missions.updated_at
CREATE OR REPLACE FUNCTION update_swarm_missions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER swarm_missions_updated_at_trigger
    BEFORE UPDATE ON swarm_missions
    FOR EACH ROW
    EXECUTE FUNCTION update_swarm_missions_updated_at();

-- Update trigger for swarm_agent_states.last_updated
CREATE OR REPLACE FUNCTION update_swarm_agent_states_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER swarm_agent_states_timestamp_trigger
    BEFORE UPDATE ON swarm_agent_states
    FOR EACH ROW
    EXECUTE FUNCTION update_swarm_agent_states_timestamp();
```

### Realtime Configuration

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_missions;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_agent_events;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_findings;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_agent_states;
```

## Entity Relationship Diagram

```
┌─────────────────────┐     ┌──────────────────────┐
│   scan_queue        │     │   swarm_missions     │
├─────────────────────┤     ├──────────────────────┤
│ id (PK)             │◄────┤ id (PK)              │
│ status              │     │ scan_id (FK)         │
│ repo_url            │     │ target               │
│ ...                 │     │ objective            │
└─────────────────────┘     │ mode                 │
                            │ status               │
                            │ progress             │
                            │ current_phase        │
                            │ iteration            │
                            │ findings (JSONB)     │
                            │ report_path          │
                            │ report_json          │
                            │ ...                  │
                            └──────────┬───────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│ swarm_agent_events    │ │ swarm_findings        │ │ swarm_agent_states    │
├───────────────────────┤ ├───────────────────────┤ ├───────────────────────┤
│ id (PK)               │ │ id (PK)               │ │ id (PK)               │
│ mission_id (FK)       │ │ mission_id (FK)       │ │ mission_id (FK)       │
│ agent_name            │ │ title                 │ │ agent_id              │
│ agent_team            │ │ severity              │ │ agent_name            │
│ event_type            │ │ finding_type          │ │ agent_team            │
│ message               │ │ source                │ │ status                │
│ payload (JSONB)       │ │ confirmed             │ │ iter                  │
│ ...                   │ │ evidence (JSONB)      │ │ task                  │
│                       │ │ ...                   │ │ recent_logs (JSONB)   │
└───────────────────────┘ └───────────────────────┘ └───────────────────────┘
```

## Agent Mapping

The agent states table maps to the frontend visualization:

| agent_id | Display Name | Team | Description |
|----------|-------------|------|-------------|
| purple-cmd | Purple Commander | purple | Purple Commander |
| kg-agent | Knowledge Graph | blue | Knowledge Graph Engine |
| sast-agent | SAST Semgrep | blue | SAST Semgrep Engine |
| llm-verify | LLM Verifier | blue | LLM Verifier |
| traffic-mon | Traffic Monitor | blue2 | Traffic Monitor |
| sig-detect | Signature Detector | blue2 | Signature Detection |
| redis-pub | Redis Bridge | blue2 | Redis IPC |
| red-cmd | Red Commander | red | Red Team Commander |
| alpha-recon | Alpha Recon | red | Alpha Reconnaissance |
| gamma-exploit | Gamma Exploit | red | Gamma Exploitation |
| critic | Critic Agent | red | Critic Agent |
| sandbox | Sandbox Container | sand | vibecheck-sandbox |
