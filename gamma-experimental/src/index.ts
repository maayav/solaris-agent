import { buildMission } from './config.js';
import { Orchestrator } from './orchestrator.js';
import { generateMissionId } from './utils/id.js';

async function main() {
  const missionId = generateMissionId();
  console.log(`[gamma-experimental] Mission ID: ${missionId}`);

  const mission = buildMission('http://127.0.0.1:3000', missionId);
  const orchestrator = new Orchestrator(mission);

  await orchestrator.start();
}

main().catch(console.error);
