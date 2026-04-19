// API Types
export interface ScanStatusResponse {
    scan_id: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    progress: number;
    current_stage?: string;
    stage_output?: Record<string, unknown> | null;
    error_message?: string;
    created_at?: string;
    updated_at?: string;
    /** Source of data: 'supabase' for real data, 'mock' for sample data */
    dataSource?: 'supabase' | 'mock';
}

export interface TriggerScanResponse {
    scan_id: string;
    status: string;
    repo_url: string;
}

export interface ChatMessage {
    id: string;
    scan_id: string;
    team: "red" | "blue";
    agent_name: string;
    content: string;
    timestamp: string;
}

export interface SendChatRequest {
    team: "red" | "blue";
    message: string;
}

export interface SendChatResponse {
    response: string;
    agent: string;
}

// Vulnerability Finding Types
export interface VulnerabilityFinding {
    id: string;
    scan_id: string;
    file_path: string;
    line_start: number;
    line_end?: number;
    vuln_type: string;
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    confidence: "high" | "medium" | "low";
    confirmed: boolean;
    verification_reason?: string;
    fix_suggestion?: string;
    code_snippet?: string;
    details?: Record<string, unknown>;
    created_at?: string;
}

export interface ScanReportResponse {
    scan_id: string;
    repo_url: string;
    status: string;
    summary: {
        total: number;
        confirmed: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
    findings: VulnerabilityFinding[];
    report_path?: string;
    created_at?: string;
    completed_at?: string;
}

// ============================================================
// SWARM TYPES - New Schema from swarm-timeline-migration
// ============================================================

// Mission Timeline Event (from mission_timeline_view)
export interface MissionTimelineEvent {
    id: string;
    mission_id: string;
    event_type: string;
    agent_name: string;
    stage: string | null;
    title: string;
    description: string | null;
    success: boolean | null;
    error_type: string | null;
    created_at: string;
    iteration: number | null;
    execution_time_ms: number | null;
    child_events: number | null;
    exploit_type: string | null;
    target_url: string | null;
    was_deduplicated: boolean | null;
    attempt_number: number | null;
}

// Mission Statistics (from mission_statistics_view)
export interface MissionStatistics {
    mission_id: string;
    target: string | null;
    status: string | null;
    created_at: string | null;
    total_events: number | null;
    exploit_events: number | null;
    agent_starts: number | null;
    total_exploit_attempts: number | null;
    successful_exploits: number | null;
    failed_exploits: number | null;
    deduplicated_exploits: number | null;
    deduplication_rate_pct: number | null;
    total_findings: number | null;
    critical_findings: number | null;
    high_findings: number | null;
    max_iteration: number | null;
}

// Swarm Exploit Attempt (from swarm_exploit_attempts table)
export interface SwarmExploitAttempt {
    id: string;
    mission_id: string;
    event_id: string | null;
    exploit_type: string;
    target_url: string;
    method: string;
    payload: string | null;
    payload_hash: string | null;
    tool_used: string | null;
    command_executed: string | null;
    success: boolean;
    response_code: number | null;
    exit_code: number | null;
    error_type: string | null;
    error_message: string | null;
    stdout: string | null;
    stderr: string | null;
    evidence: Record<string, unknown>;
    created_at: string;
    execution_time_ms: number | null;
    was_deduplicated: boolean;
    deduplication_key: string | null;
    attempt_number: number | null;
    critic_evaluated: boolean | null;
    critic_success: boolean | null;
    critic_feedback: string | null;
}

// Swarm Finding (extended from new schema)
export interface SwarmFinding {
    id: string;
    mission_id: string | null;
    title: string;
    description: string | null;
    severity: string | null;
    finding_type: string | null;
    source: string | null;
    target: string | null;
    endpoint: string | null;
    file_path: string | null;
    line_start: number | null;
    line_end: number | null;
    confirmed: boolean;
    agent_name: string | null;
    evidence: Record<string, unknown>;
    cve_id: string | null;
    created_at: string;
    exploit_attempt_id: string | null;
    agent_iteration: number | null;
    confidence_score: number | null;
}

// Swarm Event (from swarm_events table)
export interface SwarmEvent {
    id: string;
    mission_id: string;
    event_type: string;
    agent_name: string;
    stage: string | null;
    title: string;
    description: string | null;
    payload: string | null;
    target: string | null;
    success: boolean | null;
    error_type: string | null;
    error_message: string | null;
    evidence: Record<string, unknown>;
    metadata: Record<string, unknown>;
    created_at: string;
    execution_time_ms: number | null;
    iteration: number | null;
    reflection_count: number | null;
    parent_event_id: string | null;
}

// Agent State (from swarm_agent_states table)
export interface AgentState {
    id: string;
    mission_id: string | null;
    agent_id: string;
    agent_name: string;
    agent_team: string;
    status: string;
    iter: string | null;
    task: string | null;
    recent_logs: Record<string, unknown>[];
    last_updated: string;
    created_at: string;
}

// Swarm Mission
export interface SwarmMission {
    id: string;
    scan_id: string | null;
    target: string;
    objective: string;
    mode: string | null;
    max_iterations: number | null;
    status: string;
    progress: number;
    current_phase: string | null;
    iteration: number;
    findings: Record<string, unknown>[];
    report_path: string | null;
    report_json: Record<string, unknown> | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string | null;
}
