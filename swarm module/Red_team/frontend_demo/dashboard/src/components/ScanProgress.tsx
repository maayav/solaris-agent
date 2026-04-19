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
} from "lucide-react";

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
    switch (status) {
      case "pending":
        return "Waiting in queue...";
      case "running":
        return "Scanning repository...";
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
      { name: "Clone Repository", threshold: 10 },
      { name: "Parse Code", threshold: 30 },
      { name: "Build Knowledge Graph", threshold: 50 },
      { name: "Run Detectors", threshold: 70 },
      { name: "LLM Verification", threshold: 90 },
      { name: "Generate Report", threshold: 100 },
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
      {(status === "running" || status === "pending") && (
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
