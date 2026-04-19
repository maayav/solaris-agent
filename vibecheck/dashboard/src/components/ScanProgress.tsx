"use client";

import { cn } from "@/lib/utils";
import { getStatusColor } from "@/lib/utils";
import type { ScanStatusResponse } from "@/types";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  Shield,
  FileCode,
  GitGraph,
  Search,
  Brain,
  Save,
  AlertCircle,
} from "lucide-react";

interface ScanProgressProps {
  scanStatus: ScanStatusResponse | null;
  repoUrl?: string;
}

// Helper to format stage output for display
function formatStageOutput(output: Record<string, unknown> | null): string[] {
  if (!output) return [];
  
  const lines: string[] = [];
  const stage = output.stage as string;
  
  switch (stage) {
    case "clone":
      if (output.repo_url) {
        lines.push(`📦 Repository: ${output.repo_url}`);
      }
      break;
    case "parse":
      if (output.nodes_parsed) {
        lines.push(`📝 Parsed ${output.nodes_parsed} code nodes`);
      }
      break;
    case "knowledge_graph":
      if (output.nodes_added) {
        lines.push(`🔗 Added ${output.nodes_added} nodes to knowledge graph`);
      }
      break;
    case "detectors":
      if (output.n_plus_1_candidates) {
        lines.push(`🔍 Found ${output.n_plus_1_candidates} N+1 query candidates`);
      }
      break;
    case "semgrep":
      if (output.findings) {
        lines.push(`🐛 Semgrep found ${output.findings} potential issues`);
      }
      if (output.nodes_created) {
        lines.push(`📄 Created ${output.nodes_created} vulnerability nodes`);
      }
      break;
    case "semantic_lifting":
      if (output.summaries_generated) {
        lines.push(`🧠 Generated ${output.summaries_generated} semantic summaries`);
      }
      if (output.files_lifted) {
        lines.push(`📁 Lifted ${output.files_lifted} files`);
      }
      break;
    case "llm_verification":
      if (output.total_candidates) {
        lines.push(`🤖 Verifying ${output.total_candidates} candidates with LLM`);
      }
      if (output.n_plus_1 !== undefined) {
        lines.push(`   • N+1 queries: ${output.n_plus_1}`);
      }
      if (output.semgrep !== undefined) {
        lines.push(`   • Semgrep findings: ${output.semgrep}`);
      }
      break;
    case "save_results":
      if (output.vulnerabilities_saved) {
        lines.push(`💾 Saved ${output.vulnerabilities_saved} vulnerability records`);
      }
      break;
    case "complete":
      lines.push(`✅ Scan completed successfully!`);
      if (output.report_path) {
        lines.push(`📄 Report: ${output.report_path}`);
      }
      break;
    case "error":
      if (output.error) {
        lines.push(`❌ Error: ${output.error}`);
      }
      break;
  }
  
  return lines;
}

interface ScanProgressProps {
  scanStatus: ScanStatusResponse | null;
  repoUrl?: string;
}

export function ScanProgress({ scanStatus, repoUrl }: ScanProgressProps) {
  if (!scanStatus) return null;

  const status = scanStatus.status;
  const progress = scanStatus.progress;

  const getStatusIcon = () => {
    switch (status) {
      case "pending":
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case "running":
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusText = () => {
    // If current_stage is available from backend, use it
    if (scanStatus.current_stage) {
      return scanStatus.current_stage;
    }
    
    switch (status) {
      case "pending":
        return "Waiting in queue...";
      case "running":
        if (progress < 5) return "Starting scan...";
        if (progress < 15) return "Cloning repository...";
        if (progress < 25) return "Parsing code...";
        if (progress < 35) return "Building knowledge graph...";
        if (progress < 50) return "Running detectors...";
        if (progress < 65) return "Running Semgrep analysis...";
        if (progress < 85) return "Running semantic lifting...";
        if (progress < 95) return "Verifying with LLM...";
        return "Saving results...";
      case "completed":
        return "Scan completed";
      case "failed":
        return "Scan failed";
      case "cancelled":
        return "Scan cancelled";
      default:
        return "Unknown status";
    }
  };

  const getProgressSteps = () => {
    const steps = [
      { name: "Clone Repository", threshold: 5 },
      { name: "Parse Code", threshold: 15 },
      { name: "Build Knowledge Graph", threshold: 25 },
      { name: "Run Detectors", threshold: 35 },
      { name: "Semgrep Analysis", threshold: 50 },
      { name: "Semantic Lifting", threshold: 65 },
      { name: "LLM Verification", threshold: 85 },
      { name: "Save Results", threshold: 95 },
    ];

    return steps.map((step, index) => {
      const isComplete = progress >= step.threshold;
      const isCurrent =
        progress >= (steps[index - 1]?.threshold || 0) &&
        progress < step.threshold;

      return (
        <div key={step.name} className="flex items-center gap-2">
          <div
            className={cn(
              "w-3 h-3 rounded-full",
              isComplete
                ? "bg-accent-primary"
                : isCurrent
                ? "bg-blue-500 animate-pulse"
                : "bg-dark-500"
            )}
          />
          <span
            className={cn(
              "text-xs",
              isComplete
                ? "text-accent-primary"
                : isCurrent
                ? "text-blue-400"
                : "text-gray-500"
            )}
          >
            {step.name}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="rounded-lg border border-dark-500 bg-dark-700 p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div>
            <p className="font-medium text-white">{getStatusText()}</p>
            {repoUrl && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                {repoUrl}
              </p>
            )}
          </div>
        </div>
        <div
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium",
            getStatusColor(status)
          )}
        >
          {status.toUpperCase()}
        </div>
      </div>

      {/* Progress bar */}
      {(status === "running" || status === "pending" || status === "completed") && (
        <>
          <div className="h-2 bg-dark-600 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-gradient-to-r from-accent-primary to-accent-hover transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Steps */}
          <div className="flex flex-wrap gap-4">{getProgressSteps()}</div>
        </>
      )}

      {/* Stage Output Details */}
      {scanStatus.stage_output && Object.keys(scanStatus.stage_output).length > 0 && (
        <div className="mt-4 p-3 rounded-lg bg-dark-600 border border-dark-500">
          <div className="flex items-center gap-2 mb-2">
            <FileCode className="w-4 h-4 text-accent-primary" />
            <span className="text-sm font-medium text-white">Stage Details</span>
          </div>
          <div className="space-y-1">
            {formatStageOutput(scanStatus.stage_output as Record<string, unknown>).map((line, idx) => (
              <p key={idx} className="text-xs text-gray-400">{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* Error message */}
      {status === "failed" && scanStatus.error_message && (
        <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <p className="text-sm text-red-400">{scanStatus.error_message}</p>
        </div>
      )}

      {/* Completion stats */}
      {status === "completed" && (
        <div className="mt-3 flex items-center gap-2 text-accent-primary">
          <Shield className="w-4 h-4" />
          <span className="text-sm">
            Scan ID: <code className="text-xs">{scanStatus.scan_id}</code>
          </span>
        </div>
      )}
    </div>
  );
}
