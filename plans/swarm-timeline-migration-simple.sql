-- Migration: Swarm Timeline & Event Tracking Schema (Simplified)
-- Only creates tables that don't exist yet
-- Run this in Supabase SQL Editor

-- ============================================================
-- 1. CREATE swarm_events TABLE (Complete Timeline)
-- ============================================================
create table if not exists public.swarm_events (
  id uuid not null default gen_random_uuid (),
  mission_id uuid not null,
  event_type text not null, -- 'exploit_attempt', 'agent_start', 'agent_complete', 'finding', 'error', 'reflection', 'task_assignment', 'kill_chain_stage'
  agent_name text not null, -- 'commander', 'alpha', 'gamma', 'critic', 'system'
  stage text null, -- 'recon', 'exploitation', 'post_exploit', 'reporting'
  
  -- Event details
  title text not null,
  description text null,
  payload text null,
  target text null,
  
  -- Status and results
  success boolean null,
  error_type text null, -- 'syntax_error', 'waf_block', 'auth_failure', 'timeout', 'not_found', 'rate_limit', 'unknown', 'payload_limit_exceeded', 'hitl_required'
  error_message text null,
  
  -- Evidence and metadata
  evidence jsonb null default '{}'::jsonb,
  metadata jsonb null default '{}'::jsonb, -- Additional structured data
  
  -- Timing
  created_at timestamp with time zone null default now(),
  execution_time_ms integer null, -- How long the operation took
  
  -- Iteration tracking
  iteration integer null default 0,
  reflection_count integer null default 0,
  
  -- Foreign keys
  parent_event_id uuid null references public.swarm_events (id) on delete set null, -- For linking retries/reflections to original
  
  constraint swarm_events_pkey primary key (id),
  constraint swarm_events_mission_id_fkey foreign KEY (mission_id) references swarm_missions (id) on delete CASCADE
) TABLESPACE pg_default;

-- Indexes for swarm_events
comment on table public.swarm_events is 'Complete timeline of all events during swarm mission execution';
create index if not exists idx_swarm_events_mission_id on public.swarm_events using btree (mission_id);
create index if not exists idx_swarm_events_event_type on public.swarm_events using btree (event_type);
create index if not exists idx_swarm_events_agent_name on public.swarm_events using btree (agent_name);
create index if not exists idx_swarm_events_created_at on public.swarm_events using btree (created_at);
create index if not exists idx_swarm_events_stage on public.swarm_events using btree (stage);
create index if not exists idx_swarm_events_mission_iteration on public.swarm_events using btree (mission_id, iteration);
create index if not exists idx_swarm_events_parent on public.swarm_events using btree (parent_event_id);

-- ============================================================
-- 2. CREATE swarm_exploit_attempts TABLE (Detailed Exploit Tracking)
-- ============================================================
create table if not exists public.swarm_exploit_attempts (
  id uuid not null default gen_random_uuid (),
  mission_id uuid not null,
  event_id uuid null references public.swarm_events (id) on delete set null,
  
  -- Exploit details
  exploit_type text not null, -- 'sqli', 'xss', 'idor', 'lfi', 'auth_bypass', etc.
  target_url text not null,
  method text not null default 'GET',
  payload text null,
  payload_hash text null, -- For deduplication tracking
  
  -- Tool information
  tool_used text null, -- 'curl', 'python', 'nuclei'
  command_executed text null,
  
  -- Results
  success boolean null default false,
  response_code integer null,
  exit_code integer null,
  
  -- Error classification
  error_type text null,
  error_message text null,
  
  -- Evidence
  stdout text null,
  stderr text null,
  evidence jsonb null default '{}'::jsonb,
  
  -- Timing
  created_at timestamp with time zone null default now(),
  execution_time_ms integer null,
  
  -- Deduplication tracking
  was_deduplicated boolean null default false,
  deduplication_key text null, -- The key used for dedup (url+method+payload)
  attempt_number integer null default 1, -- Which attempt this was (for retries)
  
  -- Critic evaluation
  critic_evaluated boolean null default false,
  critic_success boolean null,
  critic_feedback text null,
  
  constraint swarm_exploit_attempts_pkey primary key (id),
  constraint swarm_exploit_attempts_mission_id_fkey foreign KEY (mission_id) references swarm_missions (id) on delete CASCADE
) TABLESPACE pg_default;

-- Indexes for swarm_exploit_attempts
comment on table public.swarm_exploit_attempts is 'Detailed tracking of every exploit attempt including deduplicated ones';
create index if not exists idx_swarm_exploit_attempts_mission_id on public.swarm_exploit_attempts using btree (mission_id);
create index if not exists idx_swarm_exploit_attempts_exploit_type on public.swarm_exploit_attempts using btree (exploit_type);
create index if not exists idx_swarm_exploit_attempts_success on public.swarm_exploit_attempts using btree (success);
create index if not exists idx_swarm_exploit_attempts_created_at on public.swarm_exploit_attempts using btree (created_at);
create index if not exists idx_swarm_exploit_attempts_payload_hash on public.swarm_exploit_attempts using btree (payload_hash);
create index if not exists idx_swarm_exploit_attempts_deduplicated on public.swarm_exploit_attempts using btree (was_deduplicated);

-- ============================================================
-- 3. UPDATE swarm_findings TABLE (Add Missing Columns)
-- ============================================================

-- Add exploit_attempt_id column if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'swarm_findings' AND column_name = 'exploit_attempt_id') THEN
        ALTER TABLE public.swarm_findings ADD COLUMN exploit_attempt_id uuid null references public.swarm_exploit_attempts (id) on delete set null;
    END IF;
END $$;

-- Add agent_iteration column if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'swarm_findings' AND column_name = 'agent_iteration') THEN
        ALTER TABLE public.swarm_findings ADD COLUMN agent_iteration integer null default 0;
    END IF;
END $$;

-- Add confidence_score column if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'swarm_findings' AND column_name = 'confidence_score') THEN
        ALTER TABLE public.swarm_findings ADD COLUMN confidence_score float null;
    END IF;
END $$;

-- Create index for exploit_attempt_id
create index if not exists idx_swarm_findings_exploit_attempt_id on public.swarm_findings using btree (exploit_attempt_id);

-- ============================================================
-- 4. CREATE VIEWS FOR FRONTEND
-- ============================================================

-- View: mission_timeline_view
CREATE OR REPLACE VIEW public.mission_timeline_view AS
SELECT 
  se.id,
  se.mission_id,
  se.event_type,
  se.agent_name,
  se.stage,
  se.title,
  se.description,
  se.success,
  se.error_type,
  se.created_at,
  se.iteration,
  se.execution_time_ms,
  -- Count related events
  (select count(*) from swarm_events where parent_event_id = se.id) as child_events,
  -- Get exploit details if applicable
  sea.exploit_type,
  sea.target_url,
  sea.was_deduplicated,
  sea.attempt_number
FROM swarm_events se
LEFT JOIN swarm_exploit_attempts sea ON sea.event_id = se.id
ORDER BY se.created_at ASC;

COMMENT ON VIEW public.mission_timeline_view IS 'Complete mission timeline with exploit details';

-- View: mission_statistics_view
CREATE OR REPLACE VIEW public.mission_statistics_view AS
SELECT 
  m.id as mission_id,
  m.target,
  m.status,
  m.created_at,
  -- Event counts
  (select count(*) from swarm_events where mission_id = m.id) as total_events,
  (select count(*) from swarm_events where mission_id = m.id and event_type = 'exploit_attempt') as exploit_events,
  (select count(*) from swarm_events where mission_id = m.id and event_type = 'agent_start') as agent_starts,
  -- Exploit stats
  (select count(*) from swarm_exploit_attempts where mission_id = m.id) as total_exploit_attempts,
  (select count(*) from swarm_exploit_attempts where mission_id = m.id and success = true) as successful_exploits,
  (select count(*) from swarm_exploit_attempts where mission_id = m.id and success = false) as failed_exploits,
  (select count(*) from swarm_exploit_attempts where mission_id = m.id and was_deduplicated = true) as deduplicated_exploits,
  -- Deduplication rate
  case 
    when (select count(*) from swarm_exploit_attempts where mission_id = m.id) > 0 
    then round(100.0 * (select count(*) from swarm_exploit_attempts where mission_id = m.id and was_deduplicated = true) / 
               (select count(*) from swarm_exploit_attempts where mission_id = m.id), 2)
    else 0
  end as deduplication_rate_pct,
  -- Findings
  (select count(*) from swarm_findings where mission_id = m.id) as total_findings,
  (select count(*) from swarm_findings where mission_id = m.id and severity = 'critical') as critical_findings,
  (select count(*) from swarm_findings where mission_id = m.id and severity = 'high') as high_findings,
  -- Iterations
  (select max(iteration) from swarm_events where mission_id = m.id) as max_iteration
FROM swarm_missions m;

COMMENT ON VIEW public.mission_statistics_view IS 'Aggregated statistics for mission dashboard';

-- ============================================================
-- 5. ENABLE REALTIME (for live frontend updates)
-- ============================================================

-- Add tables to realtime publication (ignore if already exists)
DO $$
BEGIN
    -- Add swarm_events (check first)
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'swarm_events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE swarm_events;
    END IF;
    
    -- Add swarm_exploit_attempts (check first)
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'swarm_exploit_attempts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE swarm_exploit_attempts;
    END IF;
    
    -- Add swarm_findings (check first - may already exist)
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'swarm_findings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE swarm_findings;
    END IF;
END $$;

-- ============================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

-- Enable RLS on new tables
ALTER TABLE swarm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_exploit_attempts ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations (adjust for your security model)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'swarm_events' AND policyname = 'Allow all') THEN
        CREATE POLICY "Allow all" ON swarm_events
          FOR ALL USING (true) WITH CHECK (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'swarm_exploit_attempts' AND policyname = 'Allow all') THEN
        CREATE POLICY "Allow all" ON swarm_exploit_attempts
          FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Verify tables were created
SELECT 'swarm_events' as table_name, count(*) as row_count FROM swarm_events
UNION ALL
SELECT 'swarm_exploit_attempts', count(*) FROM swarm_exploit_attempts
UNION ALL
SELECT 'swarm_findings', count(*) FROM swarm_findings;
