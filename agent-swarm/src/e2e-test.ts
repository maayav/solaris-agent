import { EventBus } from './events/bus.js';
import { FalkorDBClient } from './infra/falkordb.js';
import { AlphaAgent } from './agents/alpha.js';
import { getConfig } from './config/index.js';
import { generateMissionId } from './utils/id.js';

const config = getConfig();

interface ReconNode {
  label: string;
  target?: string;
  port?: number;
  protocol?: string;
  path?: string;
  discovered_by?: string;
  name?: string;
  version?: string;
  evidence?: string;
}

interface CompletionResult {
  target: string;
  portsFound: number;
  endpointsFound: number;
  componentsFound: number;
  durationMs: number;
}

async function main() {
  console.log('=== Alpha Agent E2E Test (Event-Driven Scan) ===\n');

  const graph = new FalkorDBClient({
    host: process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net',
    port: parseInt(process.env.FALKORDB_PORT || '50353'),
    password: process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC',
  });
  await graph.connect();
  console.log('✓ FalkorDB connected');

  const bus = new EventBus(config.SQLITE_EVENTS_PATH);
  console.log('✓ Event Bus ready');

  const missionId = generateMissionId();
  console.log(`Mission ID: ${missionId}\n`);

  const alpha = new AlphaAgent({
    agentId: 'alpha-e2e-test',
    agentType: 'alpha',
  });

  await alpha.start();
  console.log('✓ Alpha agent started\n');

  const startTime = Date.now();
  let scanComplete = false;
  let completionResult: CompletionResult | null = null;

  console.log('Emitting scan_initiated event...');
  await bus.emit('scan_initiated', {
    missionId,
    target: '127.0.0.1',
    targetUrl: 'http://127.0.0.1:3000',
    scanType: 'full',
  }, 'alpha-e2e-test');
  console.log('✓ Event emitted\n');

  // Poll for completion
  console.log('Waiting for scan to complete...');
  while (!scanComplete) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check for MissionNode completion in graph
    try {
      const missionNodes = await graph.findNodesByLabel<{ phase: string }>('MissionNode', { mission_id: missionId });
      const firstMission = missionNodes[0];
      if (missionNodes.length > 0 && firstMission && firstMission.phase === 'complete') {
        console.log('\n[POLL] Detected mission phase=complete in graph');
        scanComplete = true;
        // Get the counts from graph
        const allNodes = await graph.findNodesByLabel<ReconNode>('reconNode', {});
        const ports = allNodes.filter((n: ReconNode) => n.label === 'PortNode');
        const endpoints = allNodes.filter((n: ReconNode) => n.label === 'EndpointNode');
        const components = allNodes.filter((n: ReconNode) => n.label === 'ComponentNode');
        completionResult = {
          target: '127.0.0.1',
          portsFound: ports.length,
          endpointsFound: endpoints.length,
          componentsFound: components.length,
          durationMs: Date.now() - startTime,
        };
      }
    } catch {
      // Ignore polling errors
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[WAIT] Still waiting... (${elapsed}s elapsed)`);
  }

  // Always print summary
  console.log('\n=== Checking FalkorDB for results ===');

  const allReconNodes = await graph.findNodesByLabel<ReconNode>('reconNode', {});

  const ports = allReconNodes.filter((n: ReconNode) => n.label === 'PortNode');
  const endpoints = allReconNodes.filter((n: ReconNode) => n.label === 'EndpointNode');
  const components = allReconNodes.filter((n: ReconNode) => n.label === 'ComponentNode');
  const findings = allReconNodes.filter((n: ReconNode) => n.label === 'FindingNode');

  console.log(`\nTotal reconNode count: ${allReconNodes.length}`);
  console.log(`PortNodes: ${ports.length}`);
  ports.slice(0, 10).forEach((p: ReconNode) => console.log(`  - ${p.target}:${p.port} (${p.protocol}) discovered_by=${p.discovered_by}`));

  console.log(`\nEndpointNodes: ${endpoints.length}`);
  endpoints.slice(0, 10).forEach((e: ReconNode) => console.log(`  - ${e.target}${e.path} [${e.discovered_by}]`));

  console.log(`\nComponentNodes: ${components.length}`);
  components.slice(0, 10).forEach((c: ReconNode) => console.log(`  - ${c.name} ${c.version || ''}`));

  console.log(`\nFindingNodes: ${findings.length}`);
  findings.slice(0, 5).forEach((f: ReconNode) => console.log(`  - ${f.evidence?.substring(0, 60)}`));

  // Print completion report if available
  if (completionResult) {
    console.log('\n=== SCAN COMPLETION REPORT ===');
    console.log(`Duration: ${Math.floor(completionResult.durationMs / 1000)}s`);
    console.log(`Ports: ${completionResult.portsFound}`);
    console.log(`Endpoints: ${completionResult.endpointsFound}`);
    console.log(`Components: ${completionResult.componentsFound}`);
  }

  // Check for mission report
  try {
    const reportDir = `/recon-reports/${missionId}`;
    const fs = await import('fs');
    if (fs.existsSync(reportDir)) {
      const files = fs.readdirSync(reportDir);
      console.log(`\n=== RECON REPORTS (${reportDir}) ===`);
      files.forEach(f => console.log(`  - ${f}`));
    }
  } catch {
    // Ignore
  }

  alpha.stop?.();
  console.log('\n✓ Test complete');

  process.exit(scanComplete ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Test failed:', err);
  process.exit(1);
});