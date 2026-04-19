-- ===========================================
-- Swarm Module Integration - Database Schema
-- ===========================================
-- Migration: 004_add_swarm_tables.sql
-- Description: Creates tables for swarm missions, agent events, and findings
-- Dependencies: 001_supabase_schema.sql (scan_queue table)
-- ===========================================

-- ===========================================
-- Swarm Missions Table
-- ===========================================
-- Stores swarm mission configuration and status
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

-- Indexes for swarm_missions
CREATE INDEX IF NOT EXISTS idx_swarm_missions_scan_id ON swarm_missions(scan_id);
CREATE INDEX IF NOT EXISTS idx_swarm_missions_status ON swarm_missions(status);
CREATE INDEX IF NOT EXISTS idx_swarm_missions_created_at ON swarm_missions(created_at DESC);

-- ===========================================
-- Swarm Agent Events Table
-- ===========================================
-- Stores real-time agent logs and events
CREATE TABLE IF NOT EXISTS swarm_agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id) ON DELETE CASCADE,
    
    -- Agent information
    agent_name TEXT NOT NULL, -- 'purple-cmd', 'alpha-recon', 'gamma-exploit', 'critic', 'blue-traffic', etc.
    agent_team TEXT NOT NULL CHECK (agent_team IN ('red', 'blue', 'purple', 'blue2', 'sand')),
    
    -- Event details
    event_type TEXT NOT NULL CHECK (event_type IN ('log', 'action', 'warning', 'error', 'success', 'info', 'cmd')),
    message TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb, -- Additional structured data
    
    -- Context
    iteration INTEGER,
    phase TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for swarm_agent_events
CREATE INDEX IF NOT EXISTS idx_swarm_events_mission_id ON swarm_agent_events(mission_id);
CREATE INDEX IF NOT EXISTS idx_swarm_events_agent ON swarm_agent_events(agent_name);
CREATE INDEX IF NOT EXISTS idx_swarm_events_type ON swarm_agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_swarm_events_created ON swarm_agent_events(created_at DESC);

-- ===========================================
-- Swarm Findings Table
-- ===========================================
-- Stores vulnerabilities discovered by swarm agents
CREATE TABLE IF NOT EXISTS swarm_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id) ON DELETE CASCADE,
    
    -- Finding details
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    finding_type TEXT, -- 'SQLi', 'XSS', 'IDOR', 'RCE', 'AUTH_BYPASS', etc.
    source TEXT, -- 'SAST', 'DAST', 'RECON', 'EXPLOIT'
    
    -- Location
    target TEXT,
    endpoint TEXT,
    file_path TEXT,
    line_start INTEGER,
    line_end INTEGER,
    
    -- Status
    confirmed BOOLEAN DEFAULT FALSE,
    agent_name TEXT, -- Which agent found this
    
    -- Evidence
    evidence JSONB DEFAULT '{}'::jsonb,
    cve_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for swarm_findings
CREATE INDEX IF NOT EXISTS idx_swarm_findings_mission_id ON swarm_findings(mission_id);
CREATE INDEX IF NOT EXISTS idx_swarm_findings_severity ON swarm_findings(severity);
CREATE INDEX IF NOT EXISTS idx_swarm_findings_type ON swarm_findings(finding_type);
CREATE INDEX IF NOT EXISTS idx_swarm_findings_confirmed ON swarm_findings(confirmed);

-- ===========================================
-- Agent State Table
-- ===========================================
-- Stores current state of each agent in a mission
CREATE TABLE IF NOT EXISTS swarm_agent_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES swarm_missions(id) ON DELETE CASCADE,
    
    -- Agent identification
    agent_id TEXT NOT NULL, -- 'purple-cmd', 'kg-agent', 'sast-agent', etc.
    agent_name TEXT NOT NULL,
    agent_team TEXT NOT NULL CHECK (agent_team IN ('red', 'blue', 'purple', 'blue2', 'sand')),
    
    -- Status
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'complete', 'error', 'reviewing')),
    iter TEXT, -- Display iteration info like "ITERATION 2/3" or "PHASE: COMPLETE"
    task TEXT, -- Current task description
    
    -- Logs (last 50 stored in JSONB for quick access)
    recent_logs JSONB DEFAULT '[]'::jsonb,
    
    -- Timestamps
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint: one state per agent per mission
    UNIQUE(mission_id, agent_id)
);

-- Indexes for swarm_agent_states
CREATE INDEX IF NOT EXISTS idx_swarm_agent_states_mission_id ON swarm_agent_states(mission_id);
CREATE INDEX IF NOT EXISTS idx_swarm_agent_states_agent ON swarm_agent_states(agent_id);
CREATE INDEX IF NOT EXISTS idx_swarm_agent_states_status ON swarm_agent_states(status);

-- ===========================================
-- Functions and Triggers
-- ===========================================

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

-- ===========================================
-- Enable Realtime (for live updates)
-- ===========================================
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_missions;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_agent_events;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_findings;
ALTER PUBLICATION supabase_realtime ADD TABLE swarm_agent_states;

-- ===========================================
-- Comments
-- ===========================================
COMMENT ON TABLE swarm_missions IS 'Stores swarm penetration testing missions';
COMMENT ON TABLE swarm_agent_events IS 'Real-time logs and events from swarm agents';
COMMENT ON TABLE swarm_findings IS 'Vulnerabilities discovered by swarm agents';
COMMENT ON TABLE swarm_agent_states IS 'Current state and status of each agent in a mission';
