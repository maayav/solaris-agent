import { EventBus } from '../events/bus.js';
import { getSubscriptions } from '../events/subscriptions.js';
import { getFalkorDB, type FalkorDBClient } from '../infra/falkordb.js';
import type { SwarmEvent, SwarmEventType } from '../events/types.js';
import { AgentState, AGENT_INITIAL_STATES, canTransition } from './state.js';
import { toolRegistry } from '../core/tools/registry.js';
import { execTool } from '../core/tools/exec-tool.js';
import { loadAgentPrompt, type AgentPromptId } from '../utils/prompt-loader.js';
import { loadOverlay } from '../utils/prompt-overlay.js';
import type { ToolArgs, ExecResult } from '../core/tools/types.js';
import type { AgentRole } from '../core/tools/types.js';

export interface AgentConfig {
  agentId: string;
  agentType: string;
  pollInterval?: number;
}

export abstract class BaseAgent {
  protected agentId: string;
  protected agentType: string;
  protected graph: FalkorDBClient;
  protected eventBus: EventBus;
  protected pollInterval: number;
  protected running = false;
  protected pollingTimer: ReturnType<typeof setInterval> | null = null;

  protected state: AgentState = 'DORMANT';
  protected stateChangedAt: number = Date.now();
  protected errorMessage: string | null = null;

  protected readonly COOLDOWN_MS = 2000;
  protected readonly ERROR_BACKOFF_MS = 30000;
  protected readonly MAX_RATE_LIMIT_RETRIES = 5;
  protected readonly INITIAL_RETRY_DELAY_MS = 2000;
  protected readonly MAX_RETRY_DELAY_MS = 60000;

  private rateLimitRetries = 0;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: AgentConfig) {
    this.agentId = config.agentId;
    this.agentType = config.agentType;
    this.graph = getFalkorDB();
    this.eventBus = new EventBus();
    this.pollInterval = config.pollInterval || 5000;
  }

  abstract processEvent(event: SwarmEvent): Promise<void>;

  protected getSubscriptions(): SwarmEventType[] {
    return getSubscriptions(this.agentType);
  }

  protected transitionTo(newState: AgentState, reason?: string): void {
    if (this.state === newState) {
      return;
    }
    if (!canTransition(this.state, newState)) {
      console.warn(`[${this.agentId}] Invalid transition ${this.state}→${newState} (${reason || 'no reason'})`);
      return;
    }
    const oldState = this.state;
    this.state = newState;
    this.stateChangedAt = Date.now();
    console.log(`[${this.agentId}] State: ${oldState} → ${newState}${reason ? ` (${reason})` : ''}`);

    if (oldState === 'DORMANT' && newState !== 'DORMANT' && !this.pollingTimer) {
      console.log(`[${this.agentId}] Starting polling (${this.pollInterval}ms)`);
      this.pollingTimer = setInterval(() => {
        this.poll().catch(console.error);
      }, this.pollInterval);
    }
  }

  protected isStandby(): boolean {
    return this.state === 'STANDBY';
  }

  protected isActive(): boolean {
    return this.state === 'ACTIVE';
  }

  protected isDormant(): boolean {
    return this.state === 'DORMANT';
  }

  protected isError(): boolean {
    return this.state === 'ERROR';
  }

  protected isRateLimitError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('Rate limit') ||
      message.includes('rate_limit') ||
      message.includes('free-models-per-day') ||
      message.includes('TPM') ||
      message.includes('rate limit reached') ||
      message.includes('too many requests')
    );
  }

  protected async handleRateLimitError(error: unknown, event?: SwarmEvent): Promise<void> {
    this.rateLimitRetries++;
    const delay = Math.min(
      this.INITIAL_RETRY_DELAY_MS * Math.pow(2, this.rateLimitRetries - 1),
      this.MAX_RETRY_DELAY_MS
    );

    console.warn(`[${this.agentId}] Rate limit hit (retry ${this.rateLimitRetries}/${this.MAX_RATE_LIMIT_RETRIES}), waiting ${delay}ms`);

    if (this.rateLimitRetries >= this.MAX_RATE_LIMIT_RETRIES) {
      console.error(`[${this.agentId}] Max rate limit retries exceeded, giving up`);
      this.rateLimitRetries = 0;
      this.handleError(error);
      return;
    }

    this.retryTimeout = setTimeout(async () => {
      if (event) {
        try {
          console.log(`[${this.agentId}] Retrying event ${event.id} (attempt ${this.rateLimitRetries + 1})`);
          await this.processEvent(event);
          this.rateLimitRetries = 0;
          console.log(`[${this.agentId}] Rate limit retry succeeded`);
        } catch (retryError) {
          if (this.isRateLimitError(retryError)) {
            await this.handleRateLimitError(retryError, event);
          } else {
            this.rateLimitRetries = 0;
            this.handleError(retryError);
          }
        }
      } else {
        this.rateLimitRetries = 0;
      }
    }, delay);
  }

  protected handleError(error: unknown): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    this.errorMessage = error instanceof Error ? error.message : String(error);
    if (this.state !== 'ERROR') {
      this.transitionTo('ERROR', this.errorMessage);
      setTimeout(() => {
        this.transitionTo('DORMANT', 'error backoff complete');
      }, this.ERROR_BACKOFF_MS);
    }
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[${this.agentId}] Starting ${this.agentType} agent...`);

    await this.graph.connect();
    await toolRegistry.initialize();

    const initialState = AGENT_INITIAL_STATES[this.agentType] || 'DORMANT';
    this.transitionTo(initialState, 'initial');

    this.pollingTimer = setInterval(() => {
      this.poll().catch(console.error);
    }, this.pollInterval);

    console.log(`[${this.agentId}] Agent started in ${initialState} state, polling every ${this.pollInterval}ms`);
  }

  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    await this.graph.close();
    this.eventBus.close();

    console.log(`[${this.agentId}] Agent stopped`);
  }

  protected async poll(): Promise<void> {
    try {
      if (this.state === 'ERROR') {
        return;
      }

      const subscriptions = this.getSubscriptions();
      console.log(`[${this.agentId}] poll: calling consume for ${subscriptions.join(',')}`);
      const events = await this.eventBus.consume(
        this.agentId,
        subscriptions
      );
      console.log(`[${this.agentId}] poll: got ${events.length} events (state=${this.state})`);

      if (events.length > 0) {
        if (this.state === 'DORMANT') {
          this.transitionTo('STANDBY');
        }
        if (this.state === 'STANDBY') {
          this.transitionTo('ACTIVE');
        }
      } else if (this.state === 'ACTIVE') {
        return;
      }

      for (const event of events) {
        try {
          await this.processEvent(event);
        } catch (error) {
          console.error(`[${this.agentId}] Error processing event ${event.id}:`, error);
          if (this.isRateLimitError(error)) {
            await this.handleRateLimitError(error, event);
          } else {
            this.handleError(error);
          }
        }
      }

      if (this.state === 'ACTIVE' && events.length === 0) {
        this.transitionTo('COOLDOWN');
        setTimeout(() => {
          this.transitionAfterCooldown();
        }, this.COOLDOWN_MS);
      }
    } catch (error) {
      console.error(`[${this.agentId}] Poll error:`, error);
      if (this.isRateLimitError(error)) {
        await this.handleRateLimitError(error);
      } else {
        this.handleError(error);
      }
    }
  }

  private async transitionAfterCooldown(): Promise<void> {
    if (this.state !== 'COOLDOWN') return;

    const count = await this.eventBus.getPendingCount(this.getSubscriptions());
    if (count > 0) {
      this.transitionTo('STANDBY');
    } else {
      const initialState = AGENT_INITIAL_STATES[this.agentType] || 'DORMANT';
      this.transitionTo(initialState);
    }
  }

  protected async emit(type: SwarmEventType, payload: Record<string, unknown>): Promise<string> {
    return this.eventBus.emit(type, payload, this.agentId);
  }

  protected async executeTool(name: string, args: ToolArgs): Promise<ExecResult> {
    const role = this.agentType as AgentRole;
    return toolRegistry.executeForRole(role, name, args);
  }

  protected async executeCommand(command: string, timeout = 60000): Promise<ExecResult> {
    return execTool(command, { timeout });
  }

  protected getSystemPrompt(exploitType?: string): string {
    const promptId = this.getPromptId();
    let prompt = loadAgentPrompt(promptId);
    
    if (exploitType) {
      const overlay = loadOverlay(exploitType);
      if (overlay) {
        prompt += '\n\n---\n\n## Exploit-Specific Context\n\n' + overlay;
      }
    }
    
    return prompt;
  }

  protected getPromptId(): AgentPromptId {
    const mapping: Record<string, AgentPromptId> = {
      commander: 'commander',
      gamma: 'gamma',
      alpha: 'alpha-recon',
      osint: 'osint',
      verifier: 'verifier',
      critic: 'critic',
      mission_planner: 'mission-planner',
      chain_planner: 'chain-planner',
      mcp: 'mcp-agent',
      post_exploit: 'post-exploit',
      report_agent: 'report-agent',
      specialist: 'specialist',
    };
    
    return mapping[this.agentType] ?? 'commander';
  }
}
