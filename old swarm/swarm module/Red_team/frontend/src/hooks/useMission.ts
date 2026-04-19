"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MissionState, MissionPhase, AgentRole } from "@/types";
import api from "@/lib/api";

interface UseMissionOptions {
    pollInterval?: number;
    maxRetries?: number;
    onComplete?: (state: MissionState) => void;
    onError?: (error: Error) => void;
}

interface UseMissionReturn {
    missionId: string | null;
    missionState: MissionState | null;
    isLoading: boolean;
    error: string | null;
    startMission: (target: string, objective?: string) => Promise<void>;
    cancelMission: () => Promise<void>;
    reset: () => void;
}

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_MAX_RETRIES = 10;

const phaseProgress: Record<MissionPhase, number> = {
    planning: 10,
    recon: 35,
    exploitation: 65,
    reporting: 90,
    complete: 100,
};

export function useMission(options: UseMissionOptions = {}): UseMissionReturn {
    const {
        pollInterval = DEFAULT_POLL_INTERVAL,
        maxRetries = DEFAULT_MAX_RETRIES,
        onComplete,
        onError,
    } = options;

    const [missionId, setMissionId] = useState<string | null>(null);
    const [missionState, setMissionState] = useState<MissionState | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const retryCountRef = useRef(0);

    const stopPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        retryCountRef.current = 0;
    }, []);

    const pollStatus = useCallback(
        async (id: string) => {
            try {
                const statusResponse = await api.getMissionStatus(id);
                retryCountRef.current = 0;

                const phase = statusResponse.phase as MissionPhase;
                const currentAgent = statusResponse.current_agent as AgentRole | null;

                setMissionState((prev) =>
                    prev
                        ? {
                            ...prev,
                            phase,
                            status: statusResponse.status as MissionState["status"],
                            progress: phaseProgress[phase] || statusResponse.progress,
                            current_agent: currentAgent,
                            iteration: statusResponse.iteration,
                            max_iterations: statusResponse.max_iterations,
                        }
                        : null
                );

                if (statusResponse.status === "completed") {
                    stopPolling();
                    try {
                        const reportResponse = await api.getMissionReport(id);
                        setMissionState((prev) =>
                            prev
                                ? {
                                    ...prev,
                                    ...reportResponse,
                                    status: "completed",
                                    progress: 100,
                                }
                                : null
                        );
                        setIsLoading(false);
                        if (missionState) {
                            onComplete?.(missionState);
                        }
                    } catch (err) {
                        console.error("Failed to fetch report:", err);
                        setIsLoading(false);
                    }
                } else if (statusResponse.status === "failed") {
                    stopPolling();
                    setIsLoading(false);
                    setError(statusResponse.error_message || "Mission failed");
                    onError?.(new Error(statusResponse.error_message || "Mission failed"));
                } else if (statusResponse.status === "cancelled") {
                    stopPolling();
                    setIsLoading(false);
                    setError("Mission was cancelled");
                }
            } catch (err) {
                console.error("Failed to poll status:", err);
                retryCountRef.current += 1;

                if (retryCountRef.current >= maxRetries) {
                    stopPolling();
                    setIsLoading(false);
                    const errorMsg = `Failed to poll status after ${maxRetries} retries`;
                    setError(errorMsg);
                    onError?.(new Error(errorMsg));
                }
            }
        },
        [stopPolling, onComplete, onError, maxRetries, missionState]
    );

    const startMission = useCallback(
        async (target: string, objective?: string) => {
            setIsLoading(true);
            setError(null);
            setMissionState(null);
            retryCountRef.current = 0;

            try {
                const response = await api.startMission({
                    target,
                    objective: objective || `Assess security of ${target}`,
                });
                setMissionId(response.mission_id);

                // Initialize mission state
                const initialState: MissionState = {
                    mission_id: response.mission_id,
                    objective: objective || `Assess security of ${target}`,
                    target,
                    phase: "planning",
                    status: "running",
                    progress: 5,
                    current_agent: "commander",
                    iteration: 0,
                    max_iterations: 5,
                    blackboard: {
                        vulnerabilities: [],
                        exploitation_results: [],
                        attack_paths: [],
                    },
                    messages: [],
                    recon_results: [],
                    exploit_results: [],
                    errors: [],
                    created_at: new Date(),
                    updated_at: new Date(),
                };
                setMissionState(initialState);

                // Start polling
                pollIntervalRef.current = setInterval(() => {
                    pollStatus(response.mission_id);
                }, pollInterval);

                // Initial status check
                pollStatus(response.mission_id);
            } catch (err) {
                setIsLoading(false);
                const message =
                    err instanceof Error ? err.message : "Failed to start mission";
                setError(message);
                onError?.(new Error(message));
            }
        },
        [pollInterval, pollStatus, onError]
    );

    const cancelMission = useCallback(async () => {
        if (!missionId) return;

        try {
            await api.cancelMission(missionId);
            stopPolling();
            setIsLoading(false);
            setMissionState((prev) =>
                prev ? { ...prev, status: "cancelled" } : null
            );
        } catch (err) {
            console.error("Failed to cancel mission:", err);
        }
    }, [missionId, stopPolling]);

    const reset = useCallback(() => {
        stopPolling();
        setMissionId(null);
        setMissionState(null);
        setIsLoading(false);
        setError(null);
    }, [stopPolling]);

    useEffect(() => {
        return () => {
            stopPolling();
        };
    }, [stopPolling]);

    return {
        missionId,
        missionState,
        isLoading,
        error,
        startMission,
        cancelMission,
        reset,
    };
}
