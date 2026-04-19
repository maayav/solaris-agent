-- ===========================================
-- LLM Sessions and Conversation History
-- ===========================================
-- Stores LLM planning sessions and conversation history for Alpha agent

-- -------------------------------------------
-- LLM Sessions Table
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS llm_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    agent_type TEXT NOT NULL DEFAULT 'alpha',
    target TEXT NOT NULL,
    target_url TEXT,
    mission_id TEXT,
    scan_type TEXT DEFAULT 'full',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'cancelled')),
    total_iterations INTEGER DEFAULT 0,
    context_budget_used INTEGER DEFAULT 0,
    error_message TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_llm_sessions_agent_id ON llm_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_llm_sessions_mission_id ON llm_sessions(mission_id);
CREATE INDEX IF NOT EXISTS idx_llm_sessions_status ON llm_sessions(status);
CREATE INDEX IF NOT EXISTS idx_llm_sessions_started_at ON llm_sessions(started_at);

-- -------------------------------------------
-- LLM Messages Table
-- -------------------------------------------
-- Stores each message in the LLM conversation
CREATE TABLE IF NOT EXISTS llm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES llm_sessions(id) ON DELETE CASCADE,
    
    -- Message identification
    iteration INTEGER NOT NULL,
    sequence INTEGER NOT NULL,  -- Order within iteration (1=LLM decision, 2=tool result, etc.)
    
    -- Message content
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    
    -- Parsed data (for easier querying)
    tool_name TEXT,
    command TEXT,
    reasoning TEXT,
    tool_output TEXT,
    exit_code INTEGER,
    success BOOLEAN,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(session_id, iteration, sequence)
);

CREATE INDEX IF NOT EXISTS idx_llm_messages_session_id ON llm_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_messages_iteration ON llm_messages(iteration);

-- -------------------------------------------
-- LLM Tool Executions Table
-- -------------------------------------------
-- Stores individual tool execution results
CREATE TABLE IF NOT EXISTS llm_tool_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES llm_sessions(id) ON DELETE CASCADE,
    iteration INTEGER NOT NULL,
    
    -- Tool information
    tool_name TEXT NOT NULL,
    command TEXT NOT NULL,
    args JSONB,
    
    -- Execution result
    stdout TEXT,
    stderr TEXT,
    exit_code INTEGER,
    timed_out BOOLEAN DEFAULT FALSE,
    success BOOLEAN,
    duration_ms INTEGER,
    
    -- Parsed findings from tool output
    findings JSONB,  -- Array of {type, detail, evidence}
    ports_discovered TEXT[],
    endpoints_discovered TEXT[],
    components_discovered TEXT[],
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_tool_executions_session_id ON llm_tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_tool_executions_tool_name ON llm_tool_executions(tool_name);

-- -------------------------------------------
-- LLM Discoveries Table
-- -------------------------------------------
-- Stores findings discovered during LLM planning
CREATE TABLE IF NOT EXISTS llm_discoveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES llm_sessions(id) ON DELETE CASCADE,
    
    -- Discovery type
    discovery_type TEXT NOT NULL CHECK (discovery_type IN ('port', 'endpoint', 'component', 'vulnerability')),
    
    -- Details
    identifier TEXT NOT NULL,  -- port number, path, component name, etc.
    detail TEXT,
    evidence TEXT,
    source_tool TEXT,
    iteration_discovered INTEGER,
    
    -- Graph node reference
    graph_node_id TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_discoveries_session_id ON llm_discoveries(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_discoveries_type ON llm_discoveries(discovery_type);

-- -------------------------------------------
-- RLS Policies
-- -------------------------------------------
ALTER TABLE llm_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_discoveries ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all for authenticated users" ON llm_sessions
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON llm_messages
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON llm_tool_executions
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON llm_discoveries
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Allow anon read for dashboard
CREATE POLICY "Allow read for anon users" ON llm_sessions
    FOR SELECT TO anon USING (true);

CREATE POLICY "Allow read for anon users" ON llm_messages
    FOR SELECT TO anon USING (true);

CREATE POLICY "Allow read for anon users" ON llm_tool_executions
    FOR SELECT TO anon USING (true);

CREATE POLICY "Allow read for anon users" ON llm_discoveries
    FOR SELECT TO anon USING (true);