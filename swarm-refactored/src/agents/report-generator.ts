import type { RedTeamState, Report, KillChainPhase, Phase, ExploitResult } from '../types/index.js';
import { supabaseClient } from '../core/supabase-client.js';
import { redisBus } from '../core/redis-bus.js';

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function extractEndpoint(target: string): string {
  try {
    const url = new URL(target);
    return url.pathname || '/';
  } catch {
    const match = target.match(/^https?:\/\/[^/]+(\/.*)?$/);
    return match?.[1] || '/';
  }
}

async function logExploitResultsToSupabase(
  missionId: string,
  exploitResults: ExploitResult[],
  iteration: number
): Promise<void> {
  const findings: Array<{
    missionId: string;
    title: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    findingType: string;
    target: string;
    endpoint: string;
    confirmed: boolean;
    agentName: string;
    evidence: unknown;
    agentIteration: number;
    confidenceScore: number;
  }> = [];

  for (const exploit of exploitResults) {
    try {
      await supabaseClient.logExploitAttempt({
        missionId,
        exploitType: exploit.exploit_type,
        targetUrl: exploit.target,
        success: exploit.success,
        payload: exploit.payload_used,
        responseCode: exploit.response_code,
        evidence: { output: exploit.evidence },
        executionTimeMs: exploit.execution_time,
      });

      if (exploit.success) {
        findings.push({
          missionId,
          title: `${exploit.exploit_type.toUpperCase()} on ${extractEndpoint(exploit.target)}`,
          severity: (exploit.severity as 'critical' | 'high' | 'medium' | 'low') || 'high',
          description: exploit.impact || `Successful ${exploit.exploit_type} exploitation`,
          findingType: exploit.exploit_type,
          target: exploit.target,
          endpoint: extractEndpoint(exploit.target),
          confirmed: exploit.deterministic || false,
          agentName: 'gamma',
          evidence: { output: exploit.evidence, payload: exploit.payload_used },
          agentIteration: iteration,
          confidenceScore: exploit.deterministic ? 1.0 : 0.7,
        });
      }
    } catch (error) {
      console.debug(`Failed to log exploit attempt: ${error}`);
    }
  }

  for (const finding of findings) {
    try {
      await supabaseClient.logSwarmFinding(finding);
    } catch (error) {
      console.debug(`Failed to log finding: ${error}`);
    }
  }
}

function padCenter(str: string, len: number): string {
  const padding = len - str.length;
  if (padding <= 0) return str.slice(0, len);
  const leftPad = Math.floor(padding / 2);
  return ' '.repeat(leftPad) + str + ' '.repeat(padding - leftPad);
}

function padStart2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTimestamp(): string {
  const now = new Date();
  return `${padStart2(now.getHours())}:${padStart2(now.getMinutes())}:${padStart2(now.getSeconds())}`;
}

function deduplicateExploits(exploits: { exploit_type: string; target: string; success: boolean; evidence: string }[]): { exploit_type: string; target: string; success: boolean; evidence: string }[] {
  const seen = new Map<string, typeof exploits[0]>();
  for (const exp of exploits) {
    const key = `${exp.exploit_type}:${exp.target}`;
    if (!seen.has(key) || exp.success) {
      seen.set(key, exp);
    }
  }
  return Array.from(seen.values()).slice(0, 50);
}

function formatReportText(report: Report): string {
  const timestamp = formatTimestamp();
  const companyName = 'VIBECHECK ENTERPRISE SECURITY';
  const lines: string[] = [];

  lines.push(`${timestamp} [agents.graph        ] INFO    MISSION COMPLETE - Generating Report`);
  lines.push(`${timestamp} [agents.graph        ] INFO    ============================================================`);

  const dedupedExploits = deduplicateExploits(report.exploitation_results);
  lines.push(`${timestamp} [agents.report_generator] INFO    Deduplicated ${report.exploitation_results.length} exploits to ${dedupedExploits.length} (kept best per endpoint)`);

  lines.push('');
  lines.push('╔' + '═'.repeat(79) + '╗');
  lines.push('║' + padCenter(companyName, 79) + '║');
  lines.push('║' + padCenter('AUTONOMOUS RED TEAM ASSESSMENT', 79) + '║');
  lines.push('╠' + '═'.repeat(79) + '╣');
  lines.push('║' + padCenter('CONFIDENTIAL - PROPRIETARY SECURITY INTELLIGENCE', 79) + '║');
  lines.push('╚' + '═'.repeat(79) + '╝');
  lines.push('');

  const generatedDate = report.report_metadata.generated_at;
  lines.push(`${padRight('Report ID:', 20)} ${report.report_metadata.mission_id}`);
  lines.push(`${padRight('Generated:', 20)} ${generatedDate}`);
  lines.push(`${padRight('Target:', 20)} ${report.mission_summary.target}`);
  lines.push(`${padRight('Classification:', 20)} CONFIDENTIAL - EXECUTIVE REVIEW`);
  lines.push('');
  lines.push('┌' + '─'.repeat(76) + '┐');
  lines.push('│' + padCenter('CYBER-THREAT LANDSCAPE', 76) + '│');
  lines.push('└' + '─'.repeat(76) + '┘');
  lines.push('');
  lines.push(`  ► Mission Objective: ${report.mission_summary.objective}`);
  lines.push(`  ► Kill Chain Progress: ${report.kill_chain_progress.progress_percentage.toFixed(1)}% (${report.kill_chain_progress.phases_completed.join(', ')})`);
  lines.push(`  ► Attack Vectors Tested: ${report.exploitation_results.length}`);
  lines.push(`  ► Successful Compromises: ${report.kill_chain_progress.successful_exploits}`);
  lines.push(`  ► Critical Findings: ${report.statistics.high_confidence_findings}`);
  lines.push(`  ► Risk Level: ${report.kill_chain_progress.successful_exploits > 0 ? 'HIGH' : 'LOW'}`);
  lines.push('');
  lines.push('='.repeat(80));
  lines.push('EXECUTIVE SUMMARY');
  lines.push('='.repeat(80));
  lines.push('');

  if (report.kill_chain_progress.successful_exploits > 0) {
    lines.push(`⚠️  CRITICAL: ${report.kill_chain_progress.successful_exploits} successful exploitation(s) confirmed. Immediate`);
    lines.push('   remediation is required to prevent unauthorized access and data exfiltration.');
  } else {
    lines.push('✅ No successful exploits detected during this assessment.');
  }

  if (report.mission_summary.strategy) {
    lines.push('');
    lines.push(`Strategy: ${report.mission_summary.strategy.slice(0, 200)}`);
  }

  lines.push('');
  lines.push('-'.repeat(80));
  lines.push('MISSION DETAILS');
  lines.push('-'.repeat(80));
  lines.push(`Final Phase: ${report.mission_summary.final_phase}`);
  lines.push(`Iterations Completed: ${report.mission_summary.iterations_completed}/${report.mission_summary.max_iterations}`);
  lines.push('');

  if (report.reconnaissance_findings.length > 0) {
    lines.push('-'.repeat(80));
    lines.push('RECONNAISSANCE FINDINGS');
    lines.push('-'.repeat(80));
    lines.push(`  ${report.reconnaissance_findings.length} findings recorded.`);
    lines.push('');
  }

  lines.push('-'.repeat(80));
  lines.push('EXPLOITATION RESULTS');
  lines.push('-'.repeat(80));
  lines.push('');

  const successfulCount = dedupedExploits.filter(e => e.success).length;
  const totalDeduplicated = dedupedExploits.length;
  const successRate = totalDeduplicated > 0 ? Math.round((successfulCount / totalDeduplicated) * 100) : 0;

  const tableHeader = '┌' + '─'.repeat(23) + '┬' + '─'.repeat(9) + '┬' + '─'.repeat(6) + '┬' + '─'.repeat(10) + '┐';
  const tableSep = '├' + '─'.repeat(23) + '┼' + '─'.repeat(9) + '┼' + '─'.repeat(6) + '┼' + '─'.repeat(10) + '┤';
  const tableEnd = '└' + '─'.repeat(23) + '┴' + '─'.repeat(9) + '┴' + '─'.repeat(6) + '┴' + '─'.repeat(10) + '┘';

  lines.push(tableHeader);
  lines.push('│' + padCenter('Exploit', 23) + '│' + padCenter('Status', 9) + '│' + padCenter('Time', 6) + '│' + padCenter('Severity', 10) + '│');
  lines.push(tableSep);

  const displayExploits = dedupedExploits.slice(0, 45);
  for (const exp of displayExploits) {
    const status = exp.success ? '✅ WIN  ' : '❌ FAIL ';
    lines.push('│' + padRight(exp.exploit_type, 23) + '│' + padCenter(status, 9) + '│' + padCenter('0.0s', 6) + '│' + padCenter('N/A', 10) + '│');
  }

  lines.push(tableEnd);
  lines.push('');
  lines.push(`📊 SUMMARY: ${successfulCount}/${totalDeduplicated} exploits successful (${successRate}% success rate)`);

  lines.push('');
  lines.push('-'.repeat(80));
  lines.push('MISSION STATISTICS');
  lines.push('-'.repeat(80));
  lines.push(`  Total Messages:          ${report.statistics.total_messages}`);
  lines.push(`  Intelligence Reports:    ${report.statistics.intel_reports}`);
  lines.push(`  Exploit Attempts:        ${report.exploitation_results.length}`);
  lines.push(`  Successful Exploits:     ${report.kill_chain_progress.successful_exploits}`);
  lines.push(`  High Confidence Findings: ${report.statistics.high_confidence_findings}`);
  lines.push('');

  if (report.recommendations.length > 0) {
    lines.push('='.repeat(80));
    lines.push('PRIORITY REMEDIATION RECOMMENDATIONS');
    lines.push('='.repeat(80));
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`  ${rec}`);
    }
  }

  lines.push('');
  lines.push('╔' + '═'.repeat(79) + '╗');
  lines.push('║' + padCenter(`© ${new Date().getFullYear()} VibeCheck Enterprise Security - All Rights Reserved`, 79) + '║');
  lines.push('║' + padCenter('This report contains confidential security information.', 79) + '║');
  lines.push('║' + padCenter('Distribution limited to authorized personnel only.', 79) + '║');
  lines.push('╚' + '═'.repeat(79) + '╝');
  lines.push('');
  lines.push('Report Generated by VibeCheck Autonomous Red Team Platform');
  lines.push('For inquiries: security@vibecheck.enterprise');
  lines.push('');
  lines.push('='.repeat(80));
  lines.push('END OF REPORT');
  lines.push('='.repeat(80));

  return lines.join('\n');
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

export async function report_generation_node(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  const timestamp = formatTimestamp();

  const successfulExploits = state.exploit_results.filter((e) => e.success);
  const dedupedExploits = deduplicateExploits(state.exploit_results);
  const successfulDeduplicated = dedupedExploits.filter((e) => e.success);

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
  if (successfulDeduplicated.length > 0) {
    recommendations.push(`🚨 CRITICAL: ${successfulDeduplicated.length} unique vulnerabilities confirmed - immediate remediation required`);
    for (const exp of successfulDeduplicated.slice(0, 20)) {
      recommendations.push(`  • ${exp.exploit_type} on ${exp.target}`);
    }
    if (successfulDeduplicated.length > 20) {
      recommendations.push(`  ... and ${successfulDeduplicated.length - 20} more vulnerabilities (see full report)`);
    }
  }
  if (recommendations.length === 0) {
    recommendations.push('Continue monitoring and periodic security assessments');
  }

  const report: Report = {
    report_metadata: {
      generated_at: new Date().toISOString(),
      mission_id: state.mission_id,
      report_version: '1.0',
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
      high_confidence_findings: successfulDeduplicated.length,
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
  } catch (error) {
    console.debug(`Failed to save report: ${error}`);
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

    await logExploitResultsToSupabase(state.mission_id, state.exploit_results, state.iteration);
  } catch (error) {
    console.debug(`Failed to update final mission status: ${error}`);
  }

  await redisBus.disconnect();

  return {
    phase: 'complete' as Phase,
    report,
    report_path: reportPath,
  };
}
