-- Migration: Fix Supabase Event Logging Issues
-- Run this in Supabase SQL Editor

BEGIN;

-- Step 1: Create buffer table (idempotent) - WITHOUT FK constraints
CREATE TABLE IF NOT EXISTS public.swarm_mission_events_buffer (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    mission_id uuid,
    event_type text NOT NULL,
    agent_name text NOT NULL,
    title text NOT NULL,
    description text,
    payload text,  -- Use text to avoid JSONB casting issues
    target text,
    success boolean,
    error_type text,
    error_message text,
    evidence text,  -- Use text to avoid JSONB casting issues
    metadata text,  -- Use text to avoid JSONB casting issues
    created_at timestamptz DEFAULT now(),
    iteration integer DEFAULT 0,
    phase text,
    PRIMARY KEY (id)
);

-- Step 2: Create indexes
CREATE INDEX IF NOT EXISTS idx_swarm_mission_events_buffer_mission_id 
ON public.swarm_mission_events_buffer(mission_id);

CREATE INDEX IF NOT EXISTS idx_swarm_mission_events_buffer_created_at 
ON public.swarm_mission_events_buffer(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_mission_events_buffer_event_type 
ON public.swarm_mission_events_buffer(event_type);

-- Step 3: Create the combined view - use text for all columns to avoid type issues
DROP VIEW IF EXISTS public.swarm_mission_events_combined;

CREATE VIEW public.swarm_mission_events_combined AS
SELECT 
    id::text as id,
    mission_id::text as mission_id,
    event_type::text as event_type,
    agent_name::text as agent_name,
    title::text as title,
    description::text as description,
    payload::text as payload,
    target::text as target,
    success::text as success,
    error_type::text as error_type,
    error_message::text as error_message,
    evidence::text as evidence,
    metadata::text as metadata,
    created_at as created_at,
    iteration as iteration,
    phase::text as phase,
    'swarm_events' as source_table
FROM public.swarm_events

UNION ALL

SELECT 
    id::text as id,
    mission_id::text as mission_id,
    event_type::text as event_type,
    agent_name::text as agent_name,
    title::text as title,
    description::text as description,
    payload::text as payload,
    target::text as target,
    success::text as success,
    error_type::text as error_type,
    error_message::text as error_message,
    evidence::text as evidence,
    metadata::text as metadata,
    created_at as created_at,
    iteration as iteration,
    phase::text as phase,
    'buffer' as source_table
FROM public.swarm_mission_events_buffer;

-- Step 4: Grant permissions
GRANT SELECT ON public.swarm_mission_events_buffer TO anon, authenticated;
GRANT ALL ON public.swarm_mission_events_buffer TO service_role;
GRANT SELECT ON public.swarm_mission_events_combined TO anon, authenticated;

-- Step 5: Cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_buffer_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.swarm_mission_events_buffer 
    WHERE created_at < now() - interval '7 days';
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_old_buffer_events TO anon, authenticated;

COMMIT;

-- Test: SELECT * FROM public.swarm_mission_events_combined LIMIT 10;
