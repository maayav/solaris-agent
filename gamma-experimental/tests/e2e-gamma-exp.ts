import { buildMission } from '../src/config.js';
import { Orchestrator } from '../src/orchestrator.js';
import { generateMissionId } from '../src/utils/id.js';

async function main() {
  console.log('=== Gamma Experimental E2E Test ===\n');

  const missionId = process.argv[2] || generateMissionId();
  console.log(`Mission ID: ${missionId}\n`);

  const mission = buildMission('http://127.0.0.1:3000', missionId);
  console.log(`Target: ${mission.targetUrl}`);
  console.log(`Max iterations: ${mission.maxIterations}`);
  console.log(`Recon reports: ${mission.reconReports.length}\n`);

  const orchestrator = new Orchestrator(mission);

  const startTime = Date.now();

  try {
    await orchestrator.start();
  } catch (error) {
    console.error('Mission failed:', error);
  }

  const duration = Math.floor((Date.now() - startTime) / 1000);
  console.log(`\n=== Mission Complete ===`);
  console.log(`Duration: ${duration}s`);
  console.log(`Report: ${process.env.HOME}/exploit-reports/${missionId}/exploit_report.md`);
}

main();
