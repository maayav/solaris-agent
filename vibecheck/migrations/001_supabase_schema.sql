-- ===========================================
-- Project VibeCheck - Supabase Schema
-- ===========================================
-- Run this SQL in the Supabase SQL Editor to create
-- all required tables and enable realtime.
--
-- Version: 1.0
-- Last Updated: 2026-02-18
-- ===========================================

-- -------------------------------------------
-- Projects Table
-- -------------------------------------------
-- Stores metadata about repositories being scanned
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    repo_url TEXT NOT NULL UNIQUE,
    description TEXT,
    language TEXT,
    framework TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups by repo_url
CREATE INDEX IF NOT EXISTS idx_projects_repo_url ON projects(repo_url);

-- -------------------------------------------
-- Scan Queue Table
-- -------------------------------------------
-- Manages scan jobs and their status
CREATE TABLE IF NOT EXISTS scan_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    repo_url TEXT,  -- Direct repo URL (can be null if project_id is set)
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    error_message TEXT,
    triggered_by TEXT DEFAULT 'manual',
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups by status
CREATE INDEX IF NOT EXISTS idx_scan_queue_status ON scan_queue(status);
CREATE INDEX IF NOT EXISTS idx_scan_queue_project_id ON scan_queue(project_id);

-- -------------------------------------------
-- Vulnerabilities Table
-- -------------------------------------------
-- Stores detected vulnerabilities from scans
CREATE TABLE IF NOT EXISTS vulnerabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scan_queue(id) ON DELETE CASCADE,
    
    -- Vulnerability classification
    type TEXT NOT NULL,                    -- e.g., 'N+1_QUERY', 'SQL_INJECTION', 'HARDCODED_SECRET'
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    category TEXT,                         -- e.g., 'OWASP_A1', 'CWE-89'
    
    -- Location information
    file_path TEXT NOT NULL,
    line_start INTEGER,
    line_end INTEGER,
    column_start INTEGER,
    column_end INTEGER,
    
    -- Description and evidence
    title TEXT,
    description TEXT,
    code_snippet TEXT,
    evidence TEXT,
    
    -- Verification status
    confirmed BOOLEAN DEFAULT FALSE,
    confidence_score DECIMAL(3, 2),        -- 0.00 to 1.00
    false_positive BOOLEAN DEFAULT FALSE,
    
    -- Remediation
    fix_suggestion TEXT,
    reproduction_test TEXT,                -- Test code to reproduce the issue
    
    -- Metadata
    cwe_id TEXT,                           -- e.g., 'CWE-89'
    owasp_category TEXT,                   -- e.g., 'A1:2021-Broken Access Control'
    references TEXT[],                     -- List of reference URLs
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scan_id ON vulnerabilities(scan_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity ON vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_type ON vulnerabilities(type);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_confirmed ON vulnerabilities(confirmed);

-- Unique constraint to prevent duplicate vulnerability entries and race conditions
-- This ensures only one vulnerability per scan_id + file_path + line_start combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_vulnerabilities_unique_location ON vulnerabilities(scan_id, file_path, line_start);

-- -------------------------------------------
-- Kill Chain Events Table
-- -------------------------------------------
-- Tracks red team attack progression
CREATE TABLE IF NOT EXISTS kill_chain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES scan_queue(id) ON DELETE CASCADE,
    
    -- Agent information
    agent TEXT NOT NULL CHECK (agent IN ('commander', 'alpha', 'beta', 'gamma')),
    step TEXT NOT NULL,                    -- e.g., 'recon', 'vuln_found', 'exploit', 'exfiltration'
    
    -- Event details
    action TEXT,                           -- What action was taken
    target TEXT,                           -- Target asset/endpoint
    payload JSONB,                         -- Structured event data
    
    -- Status
    success BOOLEAN DEFAULT FALSE,
    human_intervention BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    
    -- Timestamps
    duration_ms INTEGER,                   -- How long this step took
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for kill chain queries
CREATE INDEX IF NOT EXISTS idx_kill_chain_mission_id ON kill_chain_events(mission_id);
CREATE INDEX IF NOT EXISTS idx_kill_chain_agent ON kill_chain_events(agent);
CREATE INDEX IF NOT EXISTS idx_kill_chain_step ON kill_chain_events(step);

-- -------------------------------------------
-- Assets Table (Red Team Recon)
-- -------------------------------------------
-- Stores discovered assets from reconnaissance
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES scan_queue(id) ON DELETE CASCADE,
    
    -- Asset identification
    asset_type TEXT NOT NULL CHECK (asset_type IN ('host', 'port', 'endpoint', 'technology', 'credential', 'file')),
    name TEXT NOT NULL,
    value TEXT NOT NULL,                   -- URL, IP, port number, etc.
    
    -- Additional details
    metadata JSONB,
    source_agent TEXT,                     -- Which agent discovered it
    
    -- Status
    verified BOOLEAN DEFAULT FALSE,
    exploitable BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    discovered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for asset queries
CREATE INDEX IF NOT EXISTS idx_assets_mission_id ON assets(mission_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

-- -------------------------------------------
-- Red Team Missions Table
-- -------------------------------------------
-- Defines red team attack missions
CREATE TABLE IF NOT EXISTS red_team_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scan_queue(id) ON DELETE CASCADE,
    
    -- Mission details
    target_url TEXT NOT NULL,
    objective TEXT NOT NULL,               -- e.g., 'Extract admin credentials', 'Find SQL injection'
    constraints TEXT[],                    -- e.g., 'no_dos', 'no_data_destruction'
    
    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'aborted')),
    success BOOLEAN DEFAULT FALSE,
    
    -- Results
    summary TEXT,
    flag_captured TEXT,                    -- If CTF-style challenge
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Index for mission status queries
CREATE INDEX IF NOT EXISTS idx_red_team_missions_status ON red_team_missions(status);

-- -------------------------------------------
-- Enable Realtime
-- -------------------------------------------
-- Enable Supabase Realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE vulnerabilities;
ALTER PUBLICATION supabase_realtime ADD TABLE kill_chain_events;
ALTER PUBLICATION supabase_realtime ADD TABLE scan_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE assets;

-- -------------------------------------------
-- Row Level Security (RLS) Policies
-- -------------------------------------------
-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE vulnerabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_chain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE red_team_missions ENABLE ROW LEVEL SECURITY;

-- For MVP, allow all operations for authenticated users
-- In production, you'd want more granular policies

CREATE POLICY "Allow all for authenticated users" ON projects
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON scan_queue
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON vulnerabilities
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON kill_chain_events
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON assets
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON red_team_missions
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- Allow anonymous read access for dashboard (if needed)
CREATE POLICY "Allow read for anon users" ON vulnerabilities
    FOR SELECT TO anon
    USING (true);

CREATE POLICY "Allow read for anon users" ON kill_chain_events
    FOR SELECT TO anon
    USING (true);

CREATE POLICY "Allow read for anon users" ON scan_queue
    FOR SELECT TO anon
    USING (true);

-- -------------------------------------------
-- Utility Functions
-- -------------------------------------------

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vulnerabilities_updated_at
    BEFORE UPDATE ON vulnerabilities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to get scan statistics
CREATE OR REPLACE FUNCTION get_scan_stats(scan_uuid UUID)
RETURNS TABLE (
    total_vulnerabilities BIGINT,
    critical_count BIGINT,
    high_count BIGINT,
    medium_count BIGINT,
    low_count BIGINT,
    confirmed_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as total_vulnerabilities,
        COUNT(*) FILTER (WHERE v.severity = 'critical') as critical_count,
        COUNT(*) FILTER (WHERE v.severity = 'high') as high_count,
        COUNT(*) FILTER (WHERE v.severity = 'medium') as medium_count,
        COUNT(*) FILTER (WHERE v.severity = 'low') as low_count,
        COUNT(*) FILTER (WHERE v.confirmed = true) as confirmed_count
    FROM vulnerabilities v
    WHERE v.scan_id = scan_uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to get kill chain progress
CREATE OR REPLACE FUNCTION get_kill_chain_progress(mission_uuid UUID)
RETURNS TABLE (
    total_steps BIGINT,
    completed_steps BIGINT,
    success_rate DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as total_steps,
        COUNT(*) FILTER (WHERE kce.success = true) as completed_steps,
        CASE
            WHEN COUNT(*) > 0 THEN
                ROUND(COUNT(*) FILTER (WHERE kce.success = true)::DECIMAL / COUNT(*)::DECIMAL, 2)
            ELSE 0
        END as success_rate
    FROM kill_chain_events kce
    WHERE kce.mission_id = mission_uuid;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------
-- Sample Data (Optional - for testing)
-- -------------------------------------------
-- Uncomment to insert sample data for testing

/*
-- Sample project
INSERT INTO projects (name, repo_url, description, language, framework)
VALUES ('Juice Shop', 'https://github.com/juice-shop/juice-shop', 'OWASP Juice Shop vulnerable web application', 'JavaScript', 'Express.js');

-- Sample scan
INSERT INTO scan_queue (project_id, status, triggered_by)
SELECT id, 'completed', 'manual' FROM projects WHERE name = 'Juice Shop';

-- Sample vulnerability
INSERT INTO vulnerabilities (scan_id, type, severity, file_path, line_start, description, confirmed)
SELECT 
    sq.id,
    'N+1_QUERY',
    'high',
    'routes/products.js',
    42,
    'ORM query executed inside loop, causing N+1 query problem',
    true
FROM scan_queue sq
JOIN projects p ON sq.project_id = p.id
WHERE p.name = 'Juice Shop';
*/