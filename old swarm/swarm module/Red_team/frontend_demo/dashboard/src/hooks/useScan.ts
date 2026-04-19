"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ScanStatusResponse,
  ReportResponse,
  Vulnerability,
} from "@/types";
import api from "@/lib/api";

interface UseScanOptions {
  pollInterval?: number;
  maxRetries?: number;
  onComplete?: (report: ReportResponse) => void;
  onError?: (error: Error) => void;
}

interface UseScanReturn {
  scanId: string | null;
  status: ScanStatusResponse | null;
  report: ReportResponse | null;
  vulnerabilities: Vulnerability[];
  isLoading: boolean;
  error: string | null;
  startScan: (repoUrl: string) => Promise<void>;
  cancelScan: () => Promise<void>;
  reset: () => void;
}

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_MAX_RETRIES = 10;

export function useScan(options: UseScanOptions = {}): UseScanReturn {
  const { 
    pollInterval = DEFAULT_POLL_INTERVAL, 
    maxRetries = DEFAULT_MAX_RETRIES,
    onComplete, 
    onError 
  } = options;

  const [scanId, setScanId] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatusResponse | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const currentIntervalRef = useRef(pollInterval);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    retryCountRef.current = 0;
    currentIntervalRef.current = pollInterval;
  }, [pollInterval]);

  // Poll for scan status with exponential backoff
  const pollStatus = useCallback(
    async (id: string) => {
      try {
        const statusResponse = await api.getScanStatus(id);
        setStatus(statusResponse);
        
        // Reset retry count on successful poll
        retryCountRef.current = 0;
        currentIntervalRef.current = pollInterval;

        // If scan is complete, fetch report
        if (statusResponse.status === "completed") {
          stopPolling();
          try {
            const reportResponse = await api.getReport(id);
            setReport(reportResponse);

            // Fetch vulnerabilities
            const vulnsResponse = await api.getVulnerabilities(id, {
              page_size: 100,
            });
            setVulnerabilities(vulnsResponse.vulnerabilities);

            setIsLoading(false);
            onComplete?.(reportResponse);
          } catch (err) {
            console.error("Failed to fetch report:", err);
            setIsLoading(false);
          }
        } else if (statusResponse.status === "failed") {
          stopPolling();
          setIsLoading(false);
          setError(statusResponse.error_message || "Scan failed");
          onError?.(new Error(statusResponse.error_message || "Scan failed"));
        } else if (statusResponse.status === "cancelled") {
          stopPolling();
          setIsLoading(false);
          setError("Scan was cancelled");
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
        } else {
          // Exponential backoff: double the interval, cap at 30 seconds
          currentIntervalRef.current = Math.min(
            currentIntervalRef.current * 2,
            30000
          );
          console.warn(`Poll retry ${retryCountRef.current}/${maxRetries}, next attempt in ${currentIntervalRef.current}ms`);
        }
      }
    },
    [stopPolling, onComplete, onError, maxRetries, pollInterval]
  );

  // Start scanning
  const startScan = useCallback(
    async (repoUrl: string) => {
      setIsLoading(true);
      setError(null);
      setReport(null);
      setVulnerabilities([]);
      setStatus(null);
      retryCountRef.current = 0;
      currentIntervalRef.current = pollInterval;

      try {
        const response = await api.triggerScan({ repo_url: repoUrl });
        setScanId(response.scan_id);

        // Start polling with current interval (supports backoff)
        const startPolling = () => {
          pollIntervalRef.current = setInterval(() => {
            pollStatus(response.scan_id);
          }, currentIntervalRef.current);
        };
        
        startPolling();

        // Initial status check
        pollStatus(response.scan_id);
      } catch (err) {
        setIsLoading(false);
        const message =
          err instanceof Error ? err.message : "Failed to start scan";
        setError(message);
        onError?.(new Error(message));
      }
    },
    [pollInterval, pollStatus, onError]
  );

  // Cancel scan
  const cancelScan = useCallback(async () => {
    if (!scanId) return;

    try {
      await api.cancelScan(scanId);
      stopPolling();
      setIsLoading(false);
      setStatus((prev) =>
        prev ? { ...prev, status: "cancelled" } : null
      );
    } catch (err) {
      console.error("Failed to cancel scan:", err);
    }
  }, [scanId, stopPolling]);

  // Reset state
  const reset = useCallback(() => {
    stopPolling();
    setScanId(null);
    setStatus(null);
    setReport(null);
    setVulnerabilities([]);
    setIsLoading(false);
    setError(null);
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    scanId,
    status,
    report,
    vulnerabilities,
    isLoading,
    error,
    startScan,
    cancelScan,
    reset,
  };
}
