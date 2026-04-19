import type { PhaseState, Finding, CommandResult } from './types.js';

export type Phase = 'recon' | 'exploit' | 'escalate' | 'persist' | 'exfil' | 'complete';

export const PHASE_ORDER: Phase[] = ['recon', 'exploit', 'escalate', 'persist', 'exfil'];

export function createInitialState(maxIterations: number): PhaseState {
  return {
    phase: 'recon',
    iteration: 0,
    commandsRun: [],
    findings: [],
    currentPlan: [],
    completedTasks: [],
    pendingTasks: [],
  };
}

export function advancePhase(state: PhaseState): PhaseState {
  const currentIndex = PHASE_ORDER.indexOf(state.phase);
  if (currentIndex < PHASE_ORDER.length - 1) {
    return { ...state, phase: PHASE_ORDER[currentIndex + 1] };
  }
  return { ...state, phase: 'complete' };
}

export function incrementIteration(state: PhaseState): PhaseState {
  return { ...state, iteration: state.iteration + 1 };
}

export function addCommand(state: PhaseState, cmd: string, result: CommandResult): PhaseState {
  return {
    ...state,
    commandsRun: [...state.commandsRun, cmd],
  };
}

export function addFinding(state: PhaseState, finding: Finding): PhaseState {
  const key = `${finding.type}:${finding.value.substring(0, 200)}`;
  const isDuplicate = state.findings.some(f => `${f.type}:${f.value.substring(0, 200)}` === key);
  if (isDuplicate) {
    return state;
  }
  return {
    ...state,
    findings: [...state.findings, finding],
  };
}

export function updatePlan(
  state: PhaseState,
  plan: { tasks: string[]; completedTasks: string[]; currentPlan: string[] }
): PhaseState {
  return {
    ...state,
    currentPlan: plan.currentPlan,
    completedTasks: plan.completedTasks,
    pendingTasks: plan.tasks.filter(t => !plan.completedTasks.includes(t)),
  };
}

export function isComplete(state: PhaseState, maxIterations: number): boolean {
  return state.iteration >= maxIterations || state.phase === 'complete';
}
