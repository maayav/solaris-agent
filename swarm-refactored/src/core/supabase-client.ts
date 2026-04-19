import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient as SupabaseClientType } from '@supabase/supabase-js';

export interface MissionRecord {
  id: string;
  target: string;
  status: 'running' | 'completed' | 'failed';
  created_at: string;
  updated_at?: string;
}

export interface AgentState {
  mission_id: string;
  agent_id: string;
  agent_name: string;
  agent_team: 'red' | 'blue';
  status: 'idle' | 'running' | 'complete' | 'error' | 'reviewing';
  last_updated: string;
  iter?: string;
  task?: string;
  recent_logs?: unknown[];
}

export interface SwarmEvent {
  id?: string;
  mission_id: string;
  event_type: string;
  agent_name: string;
  title: string;
  stage?: string;
  description?: string;
  payload?: string;
  target?: string;
  success?: boolean;
  error_type?: string;
  error_message?: string;
  evidence?: unknown;
  metadata?: unknown;
  execution_time_ms?: number;
  iteration?: number;
  reflection_count?: number;
  parent_event_id?: string;
  created_at?: string;
}

export interface VulnerabilityRecord {
  id?: string;
  scan_id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file_path: string;
  line_start?: number;
  line_end?: number;
  title?: string;
  description?: string;
  code_snippet?: string;
  confirmed?: boolean;
  confidence_score?: number;
  false_positive?: boolean;
  fix_suggestion?: string;
  reproduction_test?: string;
  repo_url?: string;
  created_at?: string;
}

export interface ScanQueueRecord {
  id: string;
  repo_url: string;
  status?: string;
  created_at?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string | null | undefined): boolean {
  if (!value || value === 'unknown') return false;
  return UUID_PATTERN.test(value);
}

function logWithTimestamp(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [SUPABASE:${level}] ${message}`;
  if (meta) {
    console[level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error'](logLine, meta);
  } else {
    console[level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error'](logLine);
  }
}

export class SupabaseClientWrapper {
  private client: SupabaseClientType | null = null;
  private url: string | null = null;
  private key: string | null = null;
  private _enabled = false;
  private _connected = false;

  constructor(url?: string, key?: string) {
    this.url = url || null;
    this.key = key || null;
    logWithTimestamp('DEBUG', 'SupabaseClientWrapper created (lazy - env vars loaded on connect())');
  }

  private reloadEnvVars(): void {
    const url = process.env.SUPABASE_URL || null;
    const key = process.env.SUPABASE_SERVICE_KEY || null;
    
    logWithTimestamp('DEBUG', 'Reloading env vars', { 
      hasUrl: !!url, 
      hasKey: !!key,
      urlPreview: url ? `${url.substring(0, 30)}...` : null 
    });
    
    this.url = url;
    this.key = key;
    this._enabled = !!(this.url && this.key);
  }

  async connect(): Promise<void> {
    logWithTimestamp('INFO', 'Connecting to Supabase...');
    
    this.reloadEnvVars();
    
    if (!this._enabled || !this.url || !this.key) {
      logWithTimestamp('WARN', 'Supabase client not enabled - missing URL or key');
      logWithTimestamp('WARN', 'SUPABASE_URL present:', { value: !!process.env.SUPABASE_URL });
      logWithTimestamp('WARN', 'SUPABASE_SERVICE_KEY present:', { value: !!process.env.SUPABASE_SERVICE_KEY });
      return;
    }

    const startTime = Date.now();
    try {
      logWithTimestamp('INFO', `Creating Supabase client for: ${this.url?.substring(0, 30)}...`);
      
      this.client = createClient(this.url, this.key, {
        auth: { persistSession: false },
      });
      
      logWithTimestamp('DEBUG', 'Testing connection with ping query...');
      const { error } = await this.client.from('swarm_missions').select('id').limit(1);
      
      if (error) {
        logWithTimestamp('ERROR', 'Connection test failed', { error: error.message });
        throw error;
      }
      
      this._connected = true;
      const elapsed = Date.now() - startTime;
      logWithTimestamp('INFO', `Supabase client connected successfully in ${elapsed}ms`);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logWithTimestamp('ERROR', `Failed to connect Supabase client after ${elapsed}ms:`, { error: String(error) });
      this._enabled = false;
      this._connected = false;
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get connected(): boolean {
    return this._connected;
  }

  private ensureConnected(): void {
    if (!this._enabled || !this.client || !this._connected) {
      throw new Error('Supabase client not connected');
    }
  }

  async createMission(
    missionId: string,
    target: string,
    objective?: string
  ): Promise<MissionRecord | null> {
    if (!this._enabled || !this.client) {
      logWithTimestamp('DEBUG', `Supabase not enabled - mission ${missionId} would be created`);
      return null;
    }

    if (!isValidUuid(missionId)) {
      logWithTimestamp('WARN', `Invalid mission_id: ${missionId}`);
      return null;
    }

    const startTime = Date.now();
    try {
      const missionData = {
        id: missionId,
        target,
        status: 'running',
        created_at: new Date().toISOString(),
      };

      logWithTimestamp('DEBUG', `Creating mission: ${missionId}`);
      const { data, error } = await this.client
        .from('swarm_missions')
        .insert(missionData)
        .select()
        .single();

      if (error) {
        logWithTimestamp('ERROR', 'Failed to create mission', { error: error.message, missionId });
        return null;
      }

      logWithTimestamp('INFO', `Created mission record: ${missionId} in ${Date.now() - startTime}ms`);
      return data as MissionRecord;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to create mission', { error: String(error), missionId, elapsed: Date.now() - startTime });
      return null;
    }
  }

  async updateMissionStatus(
    missionId: string,
    status: 'running' | 'completed' | 'failed'
  ): Promise<boolean> {
    if (!this._enabled || !this.client) return false;

    const startTime = Date.now();
    try {
      const { error } = await this.client
        .from('swarm_missions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', missionId);

      if (error) throw error;
      logWithTimestamp('DEBUG', `Updated mission status: ${missionId} -> ${status} in ${Date.now() - startTime}ms`);
      return true;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to update mission status', { error: String(error), missionId, elapsed: Date.now() - startTime });
      return false;
    }
  }

  async updateAgentState(
    missionId: string,
    agentId: string,
    agentName: string,
    status: AgentState['status'],
    options?: {
      agentTeam?: 'red' | 'blue';
      iteration?: number;
      task?: string;
      recentLogs?: unknown[];
    }
  ): Promise<boolean> {
    if (!this._enabled || !this.client) return false;

    if (!isValidUuid(missionId)) {
      logWithTimestamp('DEBUG', `Skipping agent state update - invalid mission_id: ${missionId}`);
      return false;
    }

    const startTime = Date.now();
    try {
      const stateData: Record<string, unknown> = {
        mission_id: missionId,
        agent_id: agentId,
        agent_name: agentName,
        agent_team: options?.agentTeam || 'red',
        status,
        last_updated: new Date().toISOString(),
      };

      if (options?.iteration !== undefined) {
        stateData['iter'] = String(options.iteration);
      }
      if (options?.task) {
        stateData['task'] = options.task;
      }
      if (options?.recentLogs) {
        stateData['recent_logs'] = options.recentLogs;
      }

      const { error } = await this.client
        .from('swarm_agent_states')
        .upsert(stateData, { onConflict: 'mission_id,agent_id' });

      if (error) throw error;
      logWithTimestamp('DEBUG', `Updated agent state: ${agentName}/${status} in ${Date.now() - startTime}ms`);
      return true;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to update agent state', { error: String(error), agentName, elapsed: Date.now() - startTime });
      return false;
    }
  }

  async logSwarmEvent(event: Omit<SwarmEvent, 'id' | 'created_at'>): Promise<string | null> {
    if (!this._enabled || !this.client) {
      logWithTimestamp('DEBUG', `Supabase not enabled - event not logged: ${event.event_type}`);
      return null;
    }

    if (!isValidUuid(event.mission_id)) {
      logWithTimestamp('DEBUG', `Skipping event log - invalid mission_id: ${event.mission_id}`);
      return null;
    }

    const startTime = Date.now();
    try {
      const { data, error } = await this.client
        .from('swarm_events')
        .insert(event as SwarmEvent)
        .select('id')
        .single();

      if (error) throw error;
      logWithTimestamp('DEBUG', `Logged swarm event: ${event.event_type}/${event.title} in ${Date.now() - startTime}ms`);
      return data?.id || null;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to log swarm event', { error: String(error), eventType: event.event_type, elapsed: Date.now() - startTime });
      return null;
    }
  }

  async logKillChainEvent(
    missionId: string,
    stage: string,
    agent: string,
    eventType: string,
    details: Record<string, unknown>,
    options?: {
      target?: string;
      success?: boolean;
      humanIntervention?: boolean;
    }
  ): Promise<boolean> {
    if (!this._enabled || !this.client) return false;

    if (!isValidUuid(missionId)) {
      logWithTimestamp('WARN', `Skipping kill chain event - invalid mission_id: ${missionId}`);
      return false;
    }

    const startTime = Date.now();
    try {
      const eventData = {
        mission_id: missionId,
        agent_name: agent,
        agent_team: 'red',
        event_type: options?.success === false ? 'error' : 'action',
        message: `${stage}/${eventType}`,
        payload: details,
        phase: stage,
      };

      const { error } = await this.client
        .from('swarm_agent_events')
        .insert(eventData);

      if (error) throw error;
      logWithTimestamp('DEBUG', `Logged kill chain event: ${stage}/${eventType} in ${Date.now() - startTime}ms`);
      return true;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to log kill chain event', { error: String(error), stage, elapsed: Date.now() - startTime });
      return false;
    }
  }

  async logExploitAttempt(data: {
    missionId: string;
    exploitType: string;
    targetUrl: string;
    method?: string;
    payload?: string;
    payloadHash?: string;
    toolUsed?: string;
    success?: boolean;
    responseCode?: number;
    exitCode?: number;
    errorType?: string;
    evidence?: unknown;
    executionTimeMs?: number;
  }): Promise<string | null> {
    if (!this._enabled || !this.client) return null;

    if (!isValidUuid(data.missionId)) {
      logWithTimestamp('DEBUG', `Skipping exploit attempt log - invalid mission_id: ${data.missionId}`);
      return null;
    }

    const startTime = Date.now();
    try {
      const attemptData = {
        mission_id: data.missionId,
        exploit_type: data.exploitType,
        target_url: data.targetUrl,
        method: data.method || 'GET',
        success: data.success || false,
        was_deduplicated: false,
        attempt_number: 1,
        payload: data.payload?.slice(0, 5000),
        payload_hash: data.payloadHash,
        tool_used: data.toolUsed,
        response_code: data.responseCode,
        exit_code: data.exitCode,
        error_type: data.errorType,
        evidence: data.evidence,
        execution_time_ms: data.executionTimeMs,
      };

      const { data: result, error } = await this.client
        .from('swarm_exploit_attempts')
        .insert(attemptData)
        .select('id')
        .single();

      if (error) throw error;
      logWithTimestamp('DEBUG', `Logged exploit attempt: ${data.exploitType} to ${data.targetUrl} in ${Date.now() - startTime}ms`);
      return result?.id || null;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to log exploit attempt', { error: String(error), elapsed: Date.now() - startTime });
      return null;
    }
  }

  async logSwarmFinding(data: {
    missionId: string;
    title: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description?: string;
    findingType?: string;
    source?: string;
    target?: string;
    endpoint?: string;
    filePath?: string;
    lineStart?: number;
    lineEnd?: number;
    confirmed?: boolean;
    agentName?: string;
    evidence?: unknown;
    cveId?: string;
    exploitAttemptId?: string;
    agentIteration?: number;
    confidenceScore?: number;
  }): Promise<string | null> {
    if (!this._enabled || !this.client) return null;

    if (!isValidUuid(data.missionId)) {
      logWithTimestamp('DEBUG', `Skipping finding log - invalid mission_id: ${data.missionId}`);
      return null;
    }

    const startTime = Date.now();
    try {
      const findingData = {
        mission_id: data.missionId,
        title: data.title,
        severity: data.severity,
        confirmed: data.confirmed || false,
        agent_iteration: data.agentIteration || 0,
        evidence: data.evidence || {},
        description: data.description,
        finding_type: data.findingType,
        source: data.source,
        target: data.target,
        endpoint: data.endpoint,
        file_path: data.filePath,
        line_start: data.lineStart,
        line_end: data.lineEnd,
        agent_name: data.agentName,
        cve_id: data.cveId,
        exploit_attempt_id: data.exploitAttemptId,
        confidence_score: data.confidenceScore,
      };

      const { data: result, error } = await this.client
        .from('swarm_findings')
        .insert(findingData)
        .select('id')
        .single();

      if (error) throw error;
      logWithTimestamp('DEBUG', `Logged finding: ${data.title} (${data.severity}) in ${Date.now() - startTime}ms`);
      return result?.id || null;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to log finding', { error: String(error), title: data.title, elapsed: Date.now() - startTime });
      return null;
    }
  }

  async getVulnerabilities(
    scanIds: string[],
    minSeverity?: string
  ): Promise<VulnerabilityRecord[]> {
    if (!this._enabled || !this.client || scanIds.length === 0) {
      logWithTimestamp('DEBUG', `Get vulnerabilities skipped: enabled=${this._enabled}, client=${!!this.client}, scanIds=${scanIds.length}`);
      return [];
    }

    const startTime = Date.now();
    try {
      logWithTimestamp('DEBUG', `Querying vulnerabilities for ${scanIds.length} scan IDs`);
      
      let query = this.client
        .from('vulnerabilities')
        .select('*')
        .in('scan_id', scanIds)
        .order('severity', { ascending: false })
        .limit(500);

      const { data, error } = await query;

      if (error) throw error;

      let vulnerabilities = (data as VulnerabilityRecord[]) || [];

      if (minSeverity) {
        const severityOrder: Record<string, number> = {
          critical: 4, high: 3, medium: 2, low: 1
        };
        const minLevel = severityOrder[minSeverity.toLowerCase()] || 2;
        vulnerabilities = vulnerabilities.filter(
          v => (severityOrder[v.severity?.toLowerCase()] || 0) >= minLevel
        );
      }

      logWithTimestamp('INFO', `Retrieved ${vulnerabilities.length} vulnerabilities in ${Date.now() - startTime}ms`);
      return vulnerabilities;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to get vulnerabilities', { error: String(error), elapsed: Date.now() - startTime });
      return [];
    }
  }

  async getScanIdsByRepo(repoPattern: string, limit: number = 100): Promise<string[]> {
    if (!this._enabled || !this.client) {
      logWithTimestamp('DEBUG', `Get scan IDs skipped: enabled=${this._enabled}, client=${!!this.client}`);
      return [];
    }

    const startTime = Date.now();
    try {
      logWithTimestamp('DEBUG', `Querying scan IDs for repo pattern: ${repoPattern}`);
      
      const { data, error } = await this.client
        .from('scan_queue')
        .select('id')
        .ilike('repo_url', `%${repoPattern}%`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      const result = (data as ScanQueueRecord[])?.map(r => r.id) || [];
      logWithTimestamp('INFO', `Found ${result.length} scan IDs for "${repoPattern}" in ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to get scan IDs', { error: String(error), repoPattern, elapsed: Date.now() - startTime });
      return [];
    }
  }

  async getRecentHighSeverityVulnerabilities(limit: number = 100): Promise<VulnerabilityRecord[]> {
    if (!this._enabled || !this.client) {
      logWithTimestamp('DEBUG', `Get recent vulns skipped: enabled=${this._enabled}, client=${!!this.client}`);
      return [];
    }

    const startTime = Date.now();
    try {
      logWithTimestamp('DEBUG', `Querying recent high-severity vulnerabilities (limit: ${limit})`);
      
      const { data, error } = await this.client
        .from('vulnerabilities')
        .select('*')
        .in('severity', ['critical', 'high'])
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      logWithTimestamp('INFO', `Retrieved ${(data as VulnerabilityRecord[])?.length || 0} recent vulnerabilities in ${Date.now() - startTime}ms`);
      return (data as VulnerabilityRecord[]) || [];
    } catch (error) {
      logWithTimestamp('ERROR', 'Failed to get recent vulnerabilities', { error: String(error), elapsed: Date.now() - startTime });
      return [];
    }
  }
}

export const supabaseClient = new SupabaseClientWrapper();
