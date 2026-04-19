// Red Team Agent System Types

// Mission Types
export type MissionPhase =
    | "planning"
    | "recon"
    | "exploitation"
    | "reporting"
    | "complete";

export type MissionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// Agent Types
export type AgentRole = "commander" | "alpha_recon" | "gamma_exploit" | "report_generator";

export interface AgentInfo {
    name: string;
    role: AgentRole;
    model: string;
    status: "idle" | "active" | "completed" | "error";
}

// A2A Message Types
export interface A2AMessage {
    id: string;
    sender: AgentRole;
    receiver: AgentRole | "all";
    content: string;
    message_type: "task" | "result" | "query" | "status" | "error";
    timestamp: Date;
    metadata?: Record<string, unknown>;
}

// Vulnerability Finding
export interface VulnerabilityFinding {
    id: string;
    type: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    title: string;
    description: string;
    file_path?: string;
    line_number?: number;
    evidence?: string;
    remediation?: string;
    confirmed: boolean;
    confidence_score?: number;
}

// Recon Results
export interface ReconResult {
    id: string;
    target: string;
    scan_type: string;
    findings: VulnerabilityFinding[];
    raw_output?: string;
    timestamp: Date;
}

// Exploit Result
export interface ExploitResult {
    id: string;
    vulnerability_id: string;
    target: string;
    exploit_type: string;
    success: boolean;
    evidence?: string;
    payload?: string;
    timestamp: Date;
}

// Blackboard (Shared Intelligence)
export interface Blackboard {
    target_info?: {
        url: string;
        tech_stack: string[];
        open_ports: number[];
        services: Record<number, string>;
    };
    vulnerabilities: VulnerabilityFinding[];
    exploitation_results: ExploitResult[];
    attack_paths: Array<{
        id: string;
        description: string;
        risk_level: string;
    }>;
}

// Mission State
export interface MissionState {
    mission_id: string;
    objective: string;
    target: string;
    phase: MissionPhase;
    status: MissionStatus;
    progress: number;
    current_agent: AgentRole | null;
    iteration: number;
    max_iterations: number;
    blackboard: Blackboard;
    messages: A2AMessage[];
    recon_results: ReconResult[];
    exploit_results: ExploitResult[];
    errors: string[];
    created_at: Date;
    updated_at: Date;
    completed_at?: Date;
}

// Chat Message (for UI)
export interface ChatMessage {
    id: string;
    role: "user" | "assistant" | "agent";
    agent_name?: AgentRole;
    content: string;
    timestamp: Date;
    isLoading?: boolean;
    findings?: VulnerabilityFinding[];
    mission_state?: MissionState;
}

// Conversation/Mission Session
export interface MissionSession {
    id: string;
    title: string;
    target: string;
    messages: ChatMessage[];
    mission_id?: string;
    created_at: Date;
    updated_at: Date;
}

// UI State Types
export interface AppState {
    sessions: MissionSession[];
    activeSessionId: string | null;
    missionState: MissionState | null;
    isLoading: boolean;
    backendStatus: "checking" | "connected" | "disconnected";
}

// API Request/Response Types
export interface StartMissionRequest {
    target: string;
    objective?: string;
    mission_id?: string;
}

export interface StartMissionResponse {
    mission_id: string;
    message: string;
}

export interface MissionStatusResponse {
    mission_id: string;
    phase: MissionPhase;
    status: MissionStatus;
    progress: number;
    current_agent: AgentRole | null;
    iteration: number;
    max_iterations: number;
    error_message: string | null;
}

export interface MissionReportResponse {
    mission_id: string;
    target: string;
    objective: string;
    phase: MissionPhase;
    report: {
        executive_summary: string;
        findings: VulnerabilityFinding[];
        recommendations: string[];
        risk_score: number;
    };
    recon_results: ReconResult[];
    exploit_results: ExploitResult[];
    errors: string[];
}
