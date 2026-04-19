export const API_VERSION = "v0" as const;
export const MAX_PAGE_SIZE = 100 as const;
export const DEFAULT_PAGE_SIZE = 20 as const;

// Scan stages
export const SCAN_STAGES = {
  CLONE: "clone_repository",
  PARSE: "tree_sitter_parse",
  GRAPH: "build_knowledge_graph",
  QUERY_DETECT: "n_plus_one_query_detect",
  SEMGREP: "semgrep_static_analysis",
  SEMANTIC_LIFT: "semantic_lifting",
  LLM_VERIFY: "llm_verification",
  PATTERN_PROPAGATE: "pattern_propagation",
  STORE: "supabase_storage",
} as const;

// Redis stream names
export const REDIS_STREAMS = {
  SCAN_QUEUE: "scan_queue",
  A2A_MESSAGES: "a2a_messages",
  RED_TEAM_EVENTS: "red_team_events",
  DEFENSE_ANALYTICS: "defense_analytics",
} as const;

// Scan status
export const SCAN_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

// Vulnerability severity
export const SEVERITY = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
} as const;
