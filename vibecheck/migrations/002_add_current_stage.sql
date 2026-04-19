-- ===========================================
-- Migration: Add current_stage column to scan_queue
-- ===========================================
-- This adds the current_stage column to track which pipeline
-- stage the scan is currently in.
--
-- Run this SQL in the Supabase SQL Editor
-- ===========================================

-- Add current_stage column to scan_queue
ALTER TABLE scan_queue ADD COLUMN IF NOT EXISTS current_stage TEXT;

-- Create index for faster lookups by current_stage
CREATE INDEX IF NOT EXISTS idx_scan_queue_current_stage ON scan_queue(current_stage);
