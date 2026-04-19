"use client";

import { cn } from "@/lib/utils";
import { getPhaseColor } from "@/lib/utils";
import type { MissionState, MissionPhase } from "@/types";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    Clock,
    Target,
    Shield,
    AlertTriangle,
    FileText,
} from "lucide-react";

interface MissionProgressProps {
    missionState: MissionState | null;
    targetUrl?: string;
}

const phaseInfo: Record<MissionPhase, { name: string; description: string; icon: React.ReactNode }> = {
    planning: {
        name: "Planning",
        description: "Commander analyzing target and creating strategy",
        icon: <Shield className="w-4 h-4" />,
    },
    recon: {
        name: "Reconnaissance",
        description: "Alpha Recon scanning for vulnerabilities",
        icon: <Target className="w-4 h-4" />,
    },
    exploitation: {
        name: "Exploitation",
        description: "Gamma Exploit testing vulnerabilities",
        icon: <AlertTriangle className="w-4 h-4" />,
    },
    reporting: {
        name: "Reporting",
        description: "Generating comprehensive security report",
        icon: <FileText className="w-4 h-4" />,
    },
    complete: {
        name: "Complete",
        description: "Mission finished successfully",
        icon: <CheckCircle2 className="w-4 h-4" />,
    },
};

export function MissionProgress({ missionState, targetUrl }: MissionProgressProps) {
    if (!missionState) return null;

    const phase = missionState.phase;
    const progress = missionState.progress;
    const status = missionState.status;

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
                return "Waiting to start...";
            case "running":
                return "Mission in progress...";
            case "completed":
                return "Mission completed";
            case "failed":
                return "Mission failed";
            case "cancelled":
                return "Mission cancelled";
            default:
                return "Unknown status";
        }
    };

    const getProgressSteps = () => {
        const phases: MissionPhase[] = ["planning", "recon", "exploitation", "reporting", "complete"];
        const phaseProgressMap: Record<MissionPhase, number> = {
            planning: 10,
            recon: 35,
            exploitation: 65,
            reporting: 90,
            complete: 100,
        };

        return phases.map((p, index) => {
            const isComplete = progress >= phaseProgressMap[p];
            const isCurrent =
                progress >= (phaseProgressMap[phases[index - 1]] || 0) &&
                progress < phaseProgressMap[p];

            return (
                <div key={p} className="flex items-center gap-2">
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
                        {phaseInfo[p].name}
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
                        {targetUrl && (
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Target className="w-3 h-3" />
                                {targetUrl}
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium border",
                            getPhaseColor(phase)
                        )}
                    >
                        {phase.toUpperCase()}
                    </div>
                    {missionState.iteration !== undefined && missionState.max_iterations && status === "running" && (
                        <div className="px-2 py-1 rounded-full text-xs font-medium bg-dark-600 text-gray-400">
                            Iteration: {missionState.iteration}/{missionState.max_iterations}
                        </div>
                    )}
                </div>
            </div>

            {/* Current Phase Info */}
            {status === "running" && (
                <div className="mb-4 p-3 rounded-lg bg-dark-600">
                    <div className="flex items-center gap-2 mb-1">
                        {phaseInfo[phase].icon}
                        <span className="text-sm font-medium text-white">
                            {phaseInfo[phase].name}
                        </span>
                    </div>
                    <p className="text-xs text-gray-400">{phaseInfo[phase].description}</p>
                    {missionState.current_agent && (
                        <p className="text-xs text-accent-primary mt-2">
                            Active Agent: {missionState.current_agent.replace("_", " ").toUpperCase()}
                        </p>
                    )}
                </div>
            )}

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
            {status === "failed" && missionState.errors.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <p className="text-sm text-red-400">{missionState.errors[0]}</p>
                </div>
            )}

            {/* Completion stats */}
            {status === "completed" && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="bg-dark-600 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-vuln-critical">
                            {missionState.blackboard?.vulnerabilities?.filter(v => v.severity === "critical").length || 0}
                        </p>
                        <p className="text-xs text-gray-500">Critical</p>
                    </div>
                    <div className="bg-dark-600 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-vuln-high">
                            {missionState.blackboard?.vulnerabilities?.filter(v => v.severity === "high").length || 0}
                        </p>
                        <p className="text-xs text-gray-500">High</p>
                    </div>
                    <div className="bg-dark-600 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-accent-primary">
                            {missionState.blackboard?.vulnerabilities?.length || 0}
                        </p>
                        <p className="text-xs text-gray-500">Total Findings</p>
                    </div>
                </div>
            )}
        </div>
    );
}
