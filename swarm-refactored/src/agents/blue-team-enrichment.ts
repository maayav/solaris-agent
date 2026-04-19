import type { RedTeamState, BlueTeamFinding } from '../types/index.js';
import { supabaseClient } from '../core/supabase-client.js';
import { getBlueTeamFindings, convertToReconResult, formatBlueTeamBrief } from '../core/blue-team-bridge.js';

export async function blue_team_enrichment_node(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  console.info('='.repeat(60));
  console.info('BLUE TEAM ENRICHMENT - Querying static analysis findings');
  console.info(`Mission: ${state.mission_id}, Target: ${state.target}`);
  console.info('='.repeat(60));

  let blueTeamFindings: BlueTeamFinding[] = [];
  let blueTeamIntelligenceBrief = '';

  try {
    const findings = await getBlueTeamFindings(state.target, {
      minSeverity: 'medium',
      includeUnconfirmed: false,
      repoUrl: state.repo_url || undefined,
    });

    blueTeamFindings = findings;

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
    blue_team_findings: blueTeamFindings,
    blue_team_recon_results: blueTeamFindings.map(convertToReconResult),
    blue_team_intelligence_brief: blueTeamIntelligenceBrief,
    errors: state.errors,
  };
}
