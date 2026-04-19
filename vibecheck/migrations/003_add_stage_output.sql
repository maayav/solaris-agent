-- ===========================================
-- Migration: Add stage_output column to scan_queue
-- ===========================================
-- This adds the stage_output JSONB column to store
-- intermediate results from each pipeline stage.
--
-- Run this SQL in the Supabase SQL Editor
-- ===========================================

-- Add stage_output JSONB column to scan_queue
ALTER TABLE scan_queue ADD COLUMN IF NOT EXISTS stage_output JSONB DEFAULT '{}'::jsonb;
