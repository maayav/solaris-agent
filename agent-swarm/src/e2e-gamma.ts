import { GammaAgent, type GammaConfig } from './agents/gamma.js';
import { EventBus } from './events/bus.js';
import { FalkorDBClient } from './infra/falkordb.js';
import { generateMissionId } from './utils/id.js';
import fs from 'fs';
import path from 'path';

const REPORTS = [
  '/home/peburu/recon-reports/mission:alpha-1776235882939-ryxi03',
  '/home/peburu/recon-reports/mission:alpha-1776234623974-80g2z5',
  '/home/peburu/recon-reports/mission:alpha-1776152942397-m0dkko',
];

interface CompletionResult {
  target: string;
  commandsRun: number;
  findingsFound: number;
  credentialsFound: number;
  durationMs: number;
}

async function main() {
  console.log('=== Gamma Exploit Agent E2E Test ===\n');

  const graph = new FalkorDBClient({
    host: process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net',
    port: parseInt(process.env.FALKORDB_PORT || '50353'),
    password: process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC',
  });

  await graph.connect();
  console.log('✓ FalkorDB connected');

  const bus = EventBus.getInstance();
  console.log('✓ Event Bus ready');

  console.log('\n=== Reading Alpha Recon Reports ===\n');
  const allFindings: Array<{ missionId: string; content: string }> = [];

  for (const reportDir of REPORTS) {
    const findingsPath = path.join(reportDir, 'findings_report.md');
    if (fs.existsSync(findingsPath)) {
      const content = fs.readFileSync(findingsPath, 'utf-8');
      const missionId = path.basename(reportDir);
      console.log(`✓ Found report: ${missionId} (${content.length} chars)`);
      allFindings.push({ missionId, content });
    } else {
      console.log(`✗ Report not found: ${reportDir}`);
    }
  }

  if (allFindings.length === 0) {
    console.error('No reports found, exiting');
    process.exit(1);
  }

  const combinedContent = allFindings.map(r => `## Report: ${r.missionId}\n\n${r.content}`).join('\n\n---\n\n');

  const missionId = generateMissionId();
  console.log(`\nCombined ${allFindings.length} reports (${combinedContent.length} chars)`);
  console.log(`Gamma Mission ID: ${missionId}\n`);

  const reportDir = `${process.env.HOME || '/home/peburu'}/recon-reports/${missionId}`;
  fs.mkdirSync(reportDir, { recursive: true });

  const combinedReportPath = path.join(reportDir, 'findings_report.md');
  fs.writeFileSync(combinedReportPath, combinedContent);
  console.log(`✓ Saved combined report to: ${combinedReportPath}`);

  const gammaConfig: GammaConfig = {
    agentId: 'gamma-e2e-test',
    agentType: 'gamma',
    maxIterations: 15,
  };

  const gamma = new GammaAgent(gammaConfig);
  await gamma.start();
  console.log('✓ Gamma agent started\n');

  const startTime = Date.now();
  const MAX_WAIT_MS = 600000;
  let exploitComplete = false;
  let completionResult: CompletionResult | null = null;

  console.log('Emitting scan_initiated event for gamma...');
  console.log('Target: http://127.0.0.1:3000 (OWASP Juice Shop)\n');

  await bus.emit('scan_initiated', {
    missionId,
    target: 'juiceshop',
    targetUrl: 'http://127.0.0.1:3000',
    scanType: 'full',
  }, 'gamma-e2e-test');
  console.log('✓ Event emitted\n');

  console.log('Waiting for exploit loop to complete...');
  let lastStatus = '';

  while (!exploitComplete && (Date.now() - startTime) < MAX_WAIT_MS) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const exploitReportPath = `${process.env.HOME || '/home/peburu'}/exploit-reports/${missionId}/exploit_report.md`;

    if (fs.existsSync(exploitReportPath)) {
      console.log('\n[POLL] Exploit report detected!');
      exploitComplete = true;

      const reportContent = fs.readFileSync(exploitReportPath, 'utf-8');

      const lines = reportContent.split('\n');
      let commandsRun = 0;
      let findingsFound = 0;
      let credentialsFound = 0;

      for (const line of lines) {
        const cmdMatch = line.match(/Total Commands Run\s*\|\s*(\d+)/);
        if (cmdMatch && cmdMatch[1]) commandsRun = parseInt(cmdMatch[1], 10);

        const findingsMatch = line.match(/Total Findings\s*\|\s*(\d+)/);
        if (findingsMatch && findingsMatch[1]) findingsFound = parseInt(findingsMatch[1], 10);

        const credsMatch = line.match(/Credentials\/Tokens Found\s*\|\s*(\d+)/);
        if (credsMatch && credsMatch[1]) credentialsFound = parseInt(credsMatch[1], 10);
      }

      completionResult = {
        target: 'http://127.0.0.1:3000',
        commandsRun,
        findingsFound,
        credentialsFound,
        durationMs: Date.now() - startTime,
      };
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const newStatus = `[WAIT] Still running... (${elapsed}s elapsed, max ${MAX_WAIT_MS / 1000}s)`;
    if (newStatus !== lastStatus) {
      console.log(newStatus);
      lastStatus = newStatus;
    }
  }

  if (!exploitComplete) {
    console.log('\n=== TIMEOUT: Exploit did not complete within 10 minutes ===');
  }

  console.log('\n=== Exploit Results ===\n');

  const exploitReportPath = `${process.env.HOME || '/home/peburu'}/exploit-reports/${missionId}/exploit_report.md`;

  if (fs.existsSync(exploitReportPath)) {
    const reportContent = fs.readFileSync(exploitReportPath, 'utf-8');
    console.log(reportContent);
  } else {
    console.log('No exploit report found');
  }

  if (completionResult) {
    console.log('\n=== COMPLETION REPORT ===');
    console.log(`Duration: ${Math.floor(completionResult.durationMs / 1000)}s`);
    console.log(`Commands Run: ${completionResult.commandsRun}`);
    console.log(`Findings Found: ${completionResult.findingsFound}`);
    console.log(`Credentials Found: ${completionResult.credentialsFound}`);
  }

  await gamma.stop();
  console.log('\n✓ Test complete');

  process.exit(exploitComplete ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Test failed:', err);
  process.exit(1);
});