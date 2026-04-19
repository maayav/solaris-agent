import { StateMachine, MissionState, shouldContinue, createInitialState, computeStallDetection, type CreateMissionOptions } from '../core/state-machine.js'
import { commanderPlan, commanderObserve } from './commander.js'
import { alphaRecon } from './alpha.js'
import { gammaExploit, hitlApprovalGate } from './gamma.js'
import { criticEvaluate } from './critic.js'
import { verifyChecksum, verifyScope, verifyExcluded, isExpired } from '../core/auth.js'

export function buildRedTeamGraph(): StateMachine {
  const graph = new StateMachine()

  graph.addNode('preflight_authorization', preflightAuthorization)
  graph.addNode('blue_team_enrichment', blueTeamEnrichment)
  graph.addNode('commander_plan', commanderPlan)
  graph.addNode('alpha_recon', alphaRecon)
  graph.addNode('gamma_exploit', gammaExploit)
  graph.addNode('hitl_gate', hitlApprovalGate)
  graph.addNode('critic_evaluate', criticEvaluate)
  graph.addNode('commander_observe', commanderObserve)
  graph.addNode('generate_report', generateReportNode)

  graph.addEdge('preflight_authorization', 'blue_team_enrichment')
  graph.addEdge('blue_team_enrichment', 'commander_plan')
  graph.addEdge('commander_plan', 'alpha_recon')
  graph.addEdge('alpha_recon', 'gamma_exploit')
  graph.addEdge('gamma_exploit', 'hitl_gate')
  graph.addEdge('hitl_gate', 'critic_evaluate')
  graph.addEdge('critic_evaluate', 'commander_observe')

  graph.addConditionalEdge('commander_observe', shouldContinueRouting, {
    'continue': 'alpha_recon',
    'exploit_only': 'gamma_exploit',
    'report': 'generate_report',
  })

  graph.addEdge('generate_report', 'END')

  return graph
}

function shouldContinueRouting(state: MissionState): string {
  if (state.needs_human_approval && state.human_response !== 'approved') {
    return 'hitl_gate'
  }
  return shouldContinue(state)
}

export const preflightAuthorization: (state: MissionState) => Promise<Partial<MissionState>> = async (state: MissionState) => {
  const auth = state.authorization
  
  if (!auth) {
    throw new Error('No authorization context provided. Mission rejected.')
  }

  if (!verifyChecksum(auth)) {
    throw new Error('Authorization checksum mismatch. Possible tampering detected.')
  }

  if (!verifyScope(state.target, auth.scope_domains)) {
    throw new Error(`Target ${state.target} not in authorized scope.`)
  }

  if (verifyExcluded(state.target, auth.excluded_domains)) {
    throw new Error(`Target ${state.target} in excluded domains.`)
  }

  if (isExpired(auth.expiry)) {
    throw new Error('Authorization has expired.')
  }

  return {
    authorization_verified: true,
  }
}

export const blueTeamEnrichment: (state: MissionState) => Promise<Partial<MissionState>> = async (state: MissionState) => {
  return {
    blackboard: {
      ...state.blackboard,
      blue_team_intel: [],
      defensive_mechanisms: [],
    },
  }
}

export const generateReportNode: (state: MissionState) => Promise<Partial<MissionState>> = async (state: MissionState) => {
  const report = {
    mission_id: state.mission_id,
    objective: state.objective,
    target: state.target,
    phase: 'complete',
    summary: {
      total_recon_findings: state.recon_results.length,
      total_exploit_attempts: state.exploit_results.length,
      successful_exploits: state.exploit_results.filter(e => e.success).length,
      critical_findings: state.critical_findings_count,
      high_findings: state.high_findings_count,
      coverage_score: state.coverage_score,
    },
    strategy: state.strategy,
    iteration: state.iteration,
    cost_usd: state.cost_usd,
    started_at: state.started_at,
    completed_at: new Date().toISOString(),
  }

  return {
    phase: 'complete',
    blackboard: {
      ...state.blackboard,
      final_report: report,
    },
  }
}

export { createInitialState }
