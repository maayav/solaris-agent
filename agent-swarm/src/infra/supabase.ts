import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/index.js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const config = getConfig();
  
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    throw new Error('Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }

  supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  return supabaseClient;
}

export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const client = getSupabase();
    const { error } = await client.from('cross_engagement_lessons').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

// ===========================================
// Cross-Engagement Lessons Operations
// ===========================================

export interface StackFingerprint {
  framework: string[];
  auth_type: 'jwt' | 'session' | 'oauth2' | 'api_key' | 'unknown';
  db_hints: string[];
  server?: string;
}

export interface CrossEngagementLesson {
  id: string;
  stack_fingerprint: StackFingerprint;
  engagement_id?: string;
  engagement_name?: string;
  target_class: string;
  exploit_type: string;
  failure_class?: string;
  successful_payload?: string;
  delta?: string;
  reusable: boolean;
  tags: string[];
  created_at: string;
  last_used_at?: string;
  use_count: number;
}

export async function saveCrossEngagementLesson(lesson: Omit<CrossEngagementLesson, 'id' | 'created_at' | 'use_count' | 'last_used_at'>): Promise<CrossEngagementLesson | null> {
  const client = getSupabase();
  const { data, error } = await client
    .from('cross_engagement_lessons')
    .insert(lesson)
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] Failed to save lesson:', error);
    return null;
  }
  return data as CrossEngagementLesson;
}

export async function searchLessonsByStack(
  stackFingerprint: StackFingerprint,
  targetClass: string,
  limit = 10
): Promise<CrossEngagementLesson[]> {
  const client = getSupabase();
  
  const { data, error } = await client
    .rpc('search_lessons_by_stack', {
      p_stack_fingerprint: stackFingerprint,
      p_target_class: targetClass,
      p_limit: limit
    });
  
  if (error) {
    console.error('[Supabase] Failed to search lessons:', error);
    return [];
  }
  
  return (data || []) as CrossEngagementLesson[];
}

export async function recordLessonUse(lessonId: string): Promise<void> {
  const client = getSupabase();
  await client.rpc('record_lesson_use', { p_lesson_id: lessonId });
}

// ===========================================
// Engagement Operations
// ===========================================

export interface Engagement {
  id: string;
  name: string;
  target_url: string;
  scope: string[];
  out_of_scope: string[];
  tech_stack: string[];
  status: 'active' | 'paused' | 'complete' | 'cancelled';
  started_at: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export async function createEngagement(engagement: Omit<Engagement, 'id' | 'created_at' | 'updated_at'>): Promise<Engagement | null> {
  const client = getSupabase();
  const { data, error } = await client
    .from('engagements')
    .insert(engagement)
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] Failed to create engagement:', error);
    return null;
  }
  return data as Engagement;
}

export async function getActiveEngagement(): Promise<Engagement | null> {
  const client = getSupabase();
  const { data, error } = await client
    .from('engagements')
    .select()
    .eq('status', 'active')
    .single();
  
  if (error) return null;
  return data as Engagement;
}

// ===========================================
// Run Report Operations
// ===========================================

export interface RunReport {
  id: string;
  engagement_id: string;
  summary: Record<string, unknown>;
  findings: Record<string, unknown>[];
  credentials_discovered: Record<string, unknown>[];
  attack_chains_completed: Record<string, unknown>[];
  format: 'json' | 'md' | 'html';
  version: string;
  status: 'draft' | 'review' | 'final';
  created_at: string;
  updated_at: string;
}

export async function saveRunReport(report: Omit<RunReport, 'id' | 'created_at' | 'updated_at'>): Promise<RunReport | null> {
  const client = getSupabase();
  const { data, error } = await client
    .from('run_reports')
    .insert(report)
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] Failed to save report:', error);
    return null;
  }
  return data as RunReport;
}
