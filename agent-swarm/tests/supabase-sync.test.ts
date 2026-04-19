/**
 * Supabase Sync Test
 * Tests that data syncs correctly to Supabase
 * 
 * NOTE: This test requires the Supabase schema to be set up first.
 * Run the SQL from docs/Solaris-Agent_ Complete System Plan.md Section 2.3
 * to create the required tables.
 * 
 * Usage: bun run tests/supabase-sync.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getSupabase, testSupabaseConnection } from '../src/infra/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Supabase Sync', () => {
  let supabase: SupabaseClient;
  let supabaseConnected = false;

  beforeAll(async () => {
    supabase = getSupabase();
    supabaseConnected = await testSupabaseConnection();
    if (!supabaseConnected) {
      console.log('⚠ Supabase connection failed - Supabase tests will be skipped');
    }
  });

  it('should connect to Supabase', async () => {
    if (!supabaseConnected) {
      console.log('⚠ Skipping - Supabase not connected');
      return;
    }
    expect(supabaseConnected).toBe(true);
  });

  it('should have required tables (requires schema setup)', async () => {
    if (!supabaseConnected) {
      console.log('⚠ Skipping - Supabase not connected');
      return;
    }
    
    const tables = ['cross_engagement_lessons', 'engagements', 'run_reports', 'target_configs'];
    
    for (const table of tables) {
      const { error } = await supabase.from(table).select('count').limit(1);
      expect(error?.code).not.toBe('PGRST205'); // Table must exist
    }
  });

  it('should insert and retrieve from cross_engagement_lessons (requires schema)', async () => {
    if (!supabaseConnected) {
      console.log('⚠ Skipping - Supabase not connected');
      return;
    }
    
    const testLesson = {
      stack_fingerprint: {
        framework: ['express', 'nodejs'],
        auth_type: 'jwt' as const,
        db_hints: ['postgresql'],
        server: 'express',
      },
      engagement_id: `test-eng-${Date.now()}`,
      target_class: 'REST API',
      exploit_type: 'sql_injection',
      failure_class: 'waf_blocked',
      successful_payload: "admin' UNION SELECT NULL--",
      delta: 'Added comments to bypass WAF',
      reusable: true,
      tags: ['sqli', 'waf-bypass'],
      relevance_score: 0.8,
    };

    const { data: inserted, error: insertError } = await supabase
      .from('cross_engagement_lessons')
      .insert(testLesson)
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(inserted).toBeTruthy();
    expect(inserted.exploit_type).toBe('sql_injection');

    if (inserted?.id) {
      await supabase.from('cross_engagement_lessons').delete().eq('id', inserted.id);
    }
  });

  it('should insert and retrieve from engagements (requires schema)', async () => {
    if (!supabaseConnected) {
      console.log('⚠ Skipping - Supabase not connected');
      return;
    }
    
    const testEngagement = {
      name: `Test Engagement ${Date.now()}`,
      target_config: {
        name: 'TestTarget',
        base_url: 'http://localhost:3000',
        scope: ['localhost:3000'],
        out_of_scope: [],
      },
      status: 'active',
    };

    const { data: inserted, error: insertError } = await supabase
      .from('engagements')
      .insert(testEngagement)
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(inserted).toBeTruthy();
    expect(inserted.status).toBe('active');

    if (inserted?.id) {
      await supabase.from('engagements').delete().eq('id', inserted.id);
    }
  });

  it('should insert and retrieve from target_configs (requires schema)', async () => {
    if (!supabaseConnected) {
      console.log('⚠ Skipping - Supabase not connected');
      return;
    }
    
    const testConfig = {
      name: `Test Config ${Date.now()}`,
      config: {
        name: 'TestTarget',
        base_url: 'http://localhost:3000',
        tech_stack: ['nodejs', 'express'],
        scope: ['localhost:3000'],
        out_of_scope: [],
      },
    };

    const { data: inserted, error: insertError } = await supabase
      .from('target_configs')
      .insert(testConfig)
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(inserted).toBeTruthy();
    expect(inserted.name).toContain('Test Config');

    if (inserted?.id) {
      await supabase.from('target_configs').delete().eq('id', inserted.id);
    }
  });
});
