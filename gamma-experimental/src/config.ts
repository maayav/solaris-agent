import type { Mission } from './types.js';

export const DEFAULT_MISSION: Partial<Mission> = {
  maxIterations: 25,
  maxContextTokens: 180000,
  scanType: 'full',
};

export const REFLECTION_INTERVAL = 10;
export const PHASE_ADVANCE_THRESHOLD = 3;

export const REPORTS = [
  '/home/peburu/recon-reports/mission:alpha-1776235882939-ryxi03',
  '/home/peburu/recon-reports/mission:alpha-1776234623974-80gz5',
  '/home/peburu/recon-reports/mission:alpha-1776152942397-m0dkko',
];

export function buildMission(targetUrl: string, missionId: string): Mission {
  return {
    missionId,
    target: 'juiceshop',
    targetUrl,
    scanType: 'full',
    maxIterations: 25,
    maxContextTokens: 180000,
    reconReports: REPORTS,
  };
}
