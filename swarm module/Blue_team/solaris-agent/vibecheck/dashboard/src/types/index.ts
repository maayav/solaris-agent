// API Types matching the FastAPI backend

export interface ScanTriggerRequest {
  repo_url: string;
  project_name?: string;
  triggered_by?: string;
  priority?: "low" | "normal" | "high";
}

export interface ScanTriggerResponse {
  scan_id: string;
  message: string;
  queue_position: number | null;
}

export interface ScanStatusResponse {
  scan_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  current_stage: string | null;
  stage_output: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Vulnerability {
  id: string;
  scan_id: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string | null;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  title: string | null;
  description: string | null;
  code_snippet: string | null;
  confirmed: boolean;
  confidence_score: number | null;
  false_positive: boolean;
  fix_suggestion: string | null;
  reproduction_test: string | null;
  created_at: string;
}

export interface ReportResponse {
  scan_id: string;
  project_name: string | null;
  repo_url: string | null;
  status: string;
  total_vulnerabilities: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  confirmed_count: number;
  created_at: string;
  completed_at: string | null;
  vulnerabilities: Vulnerability[];
}

export interface StatisticsResponse {
  scan_id: string;
  total_vulnerabilities: number;
  by_severity: Record<string, number>;
  by_type: Record<string, number>;
  confirmed_count: number;
  false_positive_count: number;
  average_confidence: number | null;
}

// Chat Types
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  vulnerabilities?: Vulnerability[];
  report?: ReportResponse;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  scan_id?: string;
  created_at: Date;
  updated_at: Date;
}

// UI State Types
export interface ScanState {
  scanId: string | null;
  status: ScanStatusResponse["status"] | null;
  progress: number;
  error: string | null;
  report: ReportResponse | null;
}

export interface AppState {
  conversations: Conversation[];
  activeConversationId: string | null;
  scanState: ScanState;
  isLoading: boolean;
}
