import type {
  RedTeamState,
  ContinueDecision,
  Phase,
  KillChainPhase,
  AgentRole,
  MessageType,
  Priority,
  BlueTeamFinding,
  Report,
} from '../types/index.js';
import { commander_plan, commander_observe } from '../agents/commander.js';
import { alpha_recon } from '../agents/alpha-recon.js';
import { gamma_exploit } from '../agents/gamma-exploit.js';
import { analyze_exploit_result, storeDiscoveredTokens, extractSessionTokens } from '../agents/critic-agent.js';
import { redisBus } from '../core/redis-bus.js';
import { supabaseClient } from '../core/supabase-client.js';
import { createInitialState } from '../core/state.js';
import {
  getBlueTeamFindings,
  convertToReconResult,
  formatBlueTeamBrief,
} from '../core/blue-team-bridge.js';
import type { A2AMessage, ExecResult } from '../types/index.js';

export function shouldContinue(state: RedTeamState): ContinueDecision {
  const { phase, iteration, max_iterations } = state;

  if (phase === 'complete') {
    return 'report';
  }

  if (iteration >= max_iterations) {
    return 'report';
  }

  if (phase === 'exploitation') {
    return 'exploit_only';
  }

  return 'continue';
}

export async function blue_team_enrichment(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  console.info('='.repeat(60));
  console.info('BLUE TEAM ENRICHMENT - Querying static analysis findings');
  console.info(`Mission: ${state.mission_id}, Target: ${state.target}`);
  console.info('='.repeat(60));

  try {
    await supabaseClient.connect();
  } catch (error) {
    console.warn('Supabase connection failed, continuing without Blue Team data');
  }

  const blueTeamFindinds: BlueTeamFinding[] = [];
  let blueTeamIntelligenceBrief = '';

  try {
    const findings = await getBlueTeamFindings(state.target, {
      minSeverity: 'medium',
      includeUnconfirmed: false,
      repoUrl: state.repo_url || undefined,
    });

    blueTeamFindinds.push(...findings);

    if (findings.length > 0) {
      console.info(`Loaded ${findings.length} Blue Team findings`);

      blueTeamIntelligenceBrief = formatBlueTeamBrief(findings);
      console.info('\n' + blueTeamIntelligenceBrief);
    } else {
      console.info('No Blue Team findings available for this target');
      blueTeamIntelligenceBrief = 'No Blue Team static analysis findings available. Proceed with standard reconnaissance.';
    }

    await supabaseClient.updateAgentState(
      state.mission_id,
      'commander',
      'commander',
      'complete',
      { task: 'blue_team_enrichment' }
    );

    await supabaseClient.logSwarmEvent({
      mission_id: state.mission_id,
      event_type: 'agent_start',
      agent_name: 'commander',
      title: 'Mission started — Blue Team enrichment',
      stage: 'planning',
      target: state.target,
    });
  } catch (error) {
    console.error(`Failed to enrich with Blue Team findings: ${error}`);
    blueTeamIntelligenceBrief = `Blue Team enrichment failed: ${error}`;
  }

  return {
    blue_team_findings: blueTeamFindinds,
    blue_team_recon_results: blueTeamFindinds.map(convertToReconResult),
    blue_team_intelligence_brief: blueTeamIntelligenceBrief,
    errors: state.errors,
  };
}

export async function commander_plan_node(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  try {
    const defenseIntel = await redisBus.get_latest_defense_intel(state.mission_id);
    const { stateUpdate, messages } = await commander_plan(state, defenseIntel);

    return {
      ...stateUpdate,
      messages: [...state.messages, ...messages],
    };
  } catch (error) {
    console.error('Commander plan failed:', error);
    state.errors.push(`Commander planning error: ${error}`);
    return {
      errors: state.errors,
      phase: 'complete' as Phase,
    };
  }
}

export async function alpha_recon_node(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  try {
    const { stateUpdate, messages } = await alpha_recon(state);

    return {
      ...stateUpdate,
      messages: [...state.messages, ...messages],
      recon_results: stateUpdate.recon_results || state.recon_results,
    };
  } catch (error) {
    console.error('Alpha recon failed:', error);
    state.errors.push(`Alpha recon error: ${error}`);
    return {
      errors: state.errors,
    };
  }
}

export async function gamma_exploit_node(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  try {
    const { stateUpdate, messages } = await gamma_exploit(state);

    const updatedExploitResults = stateUpdate.exploit_results || state.exploit_results;

    for (const result of updatedExploitResults.slice(-10)) {
      const execResult: ExecResult = {
        exit_code: result.success ? 0 : 1,
        stdout: result.evidence,
        stderr: '',
        command: '',
        timed_out: false,
        success: result.success,
      };

      const tokens = extractSessionTokens(execResult);
      if (tokens.length > 0) {
        await storeDiscoveredTokens(state.mission_id, tokens);
      }

      await analyze_exploit_result(result, execResult);
    }

    return {
      ...stateUpdate,
      messages: [...state.messages, ...messages],
      exploit_results: updatedExploitResults,
    };
  } catch (error) {
    console.error('Gamma exploit failed:', error);
    state.errors.push(`Gamma exploit error: ${error}`);
    return {
      errors: state.errors,
    };
  }
}

export async function hitl_approval_gate(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  console.warn('HITL Approval Gate: Skipped - Requires UI integration');

  return {
    needs_human_approval: false,
    human_response: null,
    errors: [
      ...state.errors,
      'HITL gate skipped - destructive pattern detection only',
    ],
  };
}

async function saveReportToFile(report: Report, missionId: string): Promise<string | null> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');

    const reportsDir = path.join(process.cwd(), 'reports');
    await fs.mkdir(reportsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `mission-${missionId.slice(0, 8)}-${timestamp}.txt`;
    const filePath = path.join(reportsDir, fileName);

    const textContent = formatReportText(report);
    await fs.writeFile(filePath, textContent, 'utf-8');

    console.info(`Report saved to: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Failed to save report:', error);
    return null;
  }
}

function formatReportText(report: Report): string {
  const lines: string[] = [
    '='.repeat(60),
    'RED TEAM MISSION REPORT',
    '='.repeat(60),
    '',
    `Mission ID: ${report.report_metadata.mission_id}`,
    `Generated: ${report.report_metadata.generated_at}`,
    `Version: ${report.report_metadata.report_version}`,
    '',
    '-'.repeat(60),
    'MISSION SUMMARY',
    '-'.repeat(60),
    `Objective: ${report.mission_summary.objective}`,
    `Target: ${report.mission_summary.target}`,
    `Final Phase: ${report.mission_summary.final_phase}`,
    `Iterations: ${report.mission_summary.iterations_completed}/${report.mission_summary.max_iterations}`,
    `Strategy: ${report.mission_summary.strategy}`,
    '',
    '-'.repeat(60),
    'KILL CHAIN PROGRESS',
    '-'.repeat(60),
    `Progress: ${report.kill_chain_progress.progress_percentage.toFixed(1)}%`,
    `Phases Completed: ${report.kill_chain_progress.phases_completed.join(', ')}`,
    `Successful Exploits: ${report.kill_chain_progress.successful_exploits}`,
    '',
  ];

  if (report.kill_chain_progress.narrative.length > 0) {
    lines.push('NARRATIVE:');
    for (const step of report.kill_chain_progress.narrative) {
      lines.push(`  ${step.step}. [${step.phase.toUpperCase()}] ${step.finding}`);
      lines.push(`     Impact: ${step.impact}`);
      lines.push(`     Evidence: ${step.evidence.slice(0, 100)}...`);
    }
  }

  lines.push('');
  lines.push('-'.repeat(60));
  lines.push('STATISTICS');
  lines.push('-'.repeat(60));
  lines.push(`Total Messages: ${report.statistics.total_messages}`);
  lines.push(`Intel Reports: ${report.statistics.intel_reports}`);
  lines.push(`Exploit Attempts: ${report.statistics.exploit_attempts}`);
  lines.push(`Successful Exploits: ${report.statistics.successful_exploits}`);
  lines.push(`High Confidence Findings: ${report.statistics.high_confidence_findings}`);
  lines.push(`Reflection Count: ${report.statistics.reflection_count}`);
  lines.push(`Errors: ${report.statistics.errors_count}`);

  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push('-'.repeat(60));
    lines.push('RECOMMENDATIONS');
    lines.push('-'.repeat(60));
    for (const rec of report.recommendations) {
      lines.push(`  • ${rec}`);
    }
  }

  if (report.errors.length > 0) {
    lines.push('');
    lines.push('-'.repeat(60));
    lines.push('ERRORS');
    lines.push('-'.repeat(60));
    for (const err of report.errors) {
      lines.push(`  • ${err}`);
    }
  }

  lines.push('');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

export async function report_generation(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  console.info('='.repeat(60));
  console.info('MISSION COMPLETE - Generating Report');
  console.info('='.repeat(60));

  const successfulExploits = state.exploit_results.filter((e) => e.success);
  const highConfFindings = state.recon_results.filter((f) => f.confidence >= 0.8);

  const phasesCompleted: KillChainPhase[] = [];
  if (state.recon_results.length > 0) phasesCompleted.push('reconnaissance');
  if (state.current_tasks.length > 0) phasesCompleted.push('weaponization');
  if (state.exploit_results.length > 0) phasesCompleted.push('exploitation');
  if (successfulExploits.length > 0) phasesCompleted.push('installation');
  if (successfulExploits.some((e) => ['idor', 'auth_bypass'].includes(e.exploit_type))) {
    phasesCompleted.push('c2');
    phasesCompleted.push('actions_on_objectives');
  }

  const recommendations: string[] = [];
  if (successfulExploits.length > 0) {
    recommendations.push('CRITICAL: Successful exploits detected - immediate remediation required');
    for (const exp of successfulExploits.slice(0, 5)) {
      recommendations.push(`  - ${exp.exploit_type} on ${exp.target}`);
    }
  }
  if (highConfFindings.length > 0) {
    recommendations.push(`Review ${highConfFindings.length} high-confidence reconnaissance findings`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Continue monitoring and periodic security assessments');
  }

  const report = {
    report_metadata: {
      generated_at: new Date().toISOString(),
      mission_id: state.mission_id,
      report_version: '1.0' as const,
    },
    mission_summary: {
      objective: state.objective,
      target: state.target,
      final_phase: state.phase,
      iterations_completed: state.iteration,
      max_iterations: state.max_iterations,
      strategy: state.strategy,
    },
    reconnaissance_findings: state.recon_results,
    exploitation_results: state.exploit_results,
    kill_chain_progress: {
      phases_completed: phasesCompleted,
      total_phases: 7,
      progress_percentage: (phasesCompleted.length / 7) * 100,
      successful_exploits: successfulExploits.length,
      narrative: successfulExploits.map((exp, i) => ({
        step: i + 1,
        phase: 'exploitation',
        finding: `${exp.exploit_type} on ${exp.target}`,
        asset: exp.target,
        exploit_type: exp.exploit_type,
        impact: exp.impact || 'Exploitation successful',
        evidence: exp.evidence.slice(0, 200),
        credentials_discovered: false,
      })),
    },
    statistics: {
      total_messages: state.messages.length,
      intel_reports: state.messages.filter((m) => m.type === 'INTELLIGENCE_REPORT').length,
      exploit_attempts: state.exploit_results.length,
      successful_exploits: successfulExploits.length,
      high_confidence_findings: highConfFindings.length,
      reflection_count: state.reflection_count,
      errors_count: state.errors.length,
    },
    recommendations,
    errors: state.errors,
  };

  const textContent = formatReportText(report);
  console.log('\n' + textContent);

  let reportPath: string | null = null;
  try {
    reportPath = await saveReportToFile(report, state.mission_id);
    console.info(`Report saved to: ${reportPath}`);
  } catch (error) {
    console.error('Failed to save report:', error);
  }

  try {
    await supabaseClient.updateMissionStatus(state.mission_id, 'completed');

    for (const agentId of ['commander', 'alpha', 'gamma', 'critic']) {
      await supabaseClient.updateAgentState(
        state.mission_id,
        agentId,
        agentId,
        'complete',
        { iteration: state.iteration, task: 'mission_complete' }
      );
    }

    await supabaseClient.logSwarmEvent({
      mission_id: state.mission_id,
      event_type: 'agent_complete',
      agent_name: 'commander',
      title: 'Mission completed — report generated',
      stage: 'reporting',
      iteration: state.iteration,
    });
  } catch (error) {
    console.debug(`Failed to update final mission status: ${error}`);
  }

  return {
    phase: 'complete' as Phase,
    report,
    report_path: reportPath,
  };
}

export function build_red_team_graph() {
  const graph = {
    nodes: {
      blue_team_enrichment: blue_team_enrichment,
      commander_plan: commander_plan_node,
      alpha_recon: alpha_recon_node,
      gamma_exploit: gamma_exploit_node,
      hitl_approval_gate: hitl_approval_gate,
      report_generation: report_generation,
    },
    edges: [
      { from: 'blue_team_enrichment', to: 'commander_plan' },
      { from: 'commander_plan', to: 'alpha_recon', condition: (s: RedTeamState) => s.phase === 'recon' },
      { from: 'commander_plan', to: 'gamma_exploit', condition: (s: RedTeamState) => s.phase === 'exploitation' },
      { from: 'alpha_recon', to: 'gamma_exploit' },
      { from: 'gamma_exploit', to: 'hitl_approval_gate' },
      { from: 'hitl_approval_gate', to: 'commander_plan' },
      { from: 'commander_plan', to: 'report_generation', condition: (s: RedTeamState) => shouldContinue(s) === 'report' },
    ],
    routing: {
      continue: 'alpha_recon',
      exploit_only: 'gamma_exploit',
      report: 'report_generation',
    },
  };

  return graph;
}

export async function runMission(
  missionId: string,
  objective: string,
  target: string,
  options?: {
    maxIterations?: number;
    maxReflections?: number;
    repoUrl?: string;
    fastMode?: boolean;
  }
): Promise<RedTeamState> {
  await redisBus.connect();

  let state = createInitialState(missionId, objective, target, options);

  const graph = build_red_team_graph();

  state = {
    ...state,
    messages: [...state.messages, {
      msg_id: crypto.randomUUID(),
      sender: 'commander' as AgentRole,
      recipient: 'all' as AgentRole,
      type: 'MISSION_START' as MessageType,
      priority: 'HIGH' as Priority,
      payload: { mission_id: missionId, objective, target },
      timestamp: new Date().toISOString(),
    } as A2AMessage],
  };

  while (state.phase !== 'complete' && state.iteration < state.max_iterations) {
    const decision = shouldContinue(state);

    if (decision === 'report') {
      const updates = await report_generation(state);
      state = { ...state, ...updates };
      break;
    }

    const enrichedState = await graph.nodes.blue_team_enrichment(state);
    state = { ...state, ...enrichedState };

    const planUpdates = await graph.nodes.commander_plan(state);
    state = { ...state, ...planUpdates };

    if (state.phase === 'recon') {
      const reconUpdates = await graph.nodes.alpha_recon(state);
      state = { ...state, ...reconUpdates };
    }

    if (state.phase === 'exploitation' || decision === 'exploit_only') {
      const exploitUpdates = await graph.nodes.gamma_exploit(state);
      state = { ...state, ...exploitUpdates };

      const hitlUpdates = await graph.nodes.hitl_approval_gate(state);
      state = { ...state, ...hitlUpdates };
    }

    if (state.iteration >= state.max_iterations) {
      const reportUpdates = await report_generation(state);
      state = { ...state, ...reportUpdates };
      break;
    }

    state.iteration++;
  }

  await redisBus.disconnect();

  return state;
}
