import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent } from '../events/types.js';

export interface CommanderConfig extends AgentConfig {
  agentType: 'commander';
  llmEndpoint?: string;
  llmApiKey?: string;
}

export class CommanderAgent extends BaseAgent {
  private llmEndpoint: string | null;
  private llmApiKey: string | null;

  constructor(config: CommanderConfig) {
    super(config);
    this.llmEndpoint = config.llmEndpoint || null;
    this.llmApiKey = config.llmApiKey || null;
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);
    
    switch (event.type) {
      case 'mission_queued':
        await this.handleMissionQueued(event);
        break;
      case 'mission_verified':
        await this.handleMissionVerified(event);
        break;
      case 'exploit_completed':
        await this.handleExploitCompleted(event);
        break;
      case 'exploit_failed':
        await this.handleExploitFailed(event);
        break;
      case 'swarm_complete':
        await this.handleSwarmComplete(event);
        break;
      default:
        console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
    }
  }

  private async handleMissionQueued(event: SwarmEvent): Promise<void> {
    const { missionId } = event.payload as { missionId: string };
    console.log(`[${this.agentId}] Mission queued: ${missionId}`);
    
    const mission = await this.graph.findNodeById(missionId);
    if (!mission) {
      console.error(`[${this.agentId}] Mission not found: ${missionId}`);
      return;
    }
    
    await this.graph.updateNode(missionId, { status: 'verified' });
    await this.emit('mission_verified', { missionId, verified_by: this.agentId });
  }

  private async handleMissionVerified(event: SwarmEvent): Promise<void> {
    const { missionId } = event.payload as { missionId: string };
    console.log(`[${this.agentId}] Mission verified: ${missionId}`);
  }

  private async handleExploitCompleted(event: SwarmEvent): Promise<void> {
    const { missionId, result } = event.payload as { missionId: string; result: any };
    console.log(`[${this.agentId}] Exploit completed: ${missionId}`, result);
  }

  private async handleExploitFailed(event: SwarmEvent): Promise<void> {
    const { missionId, error } = event.payload as { missionId: string; error: string };
    console.log(`[${this.agentId}] Exploit failed: ${missionId}`, error);
  }

  private async handleSwarmComplete(event: SwarmEvent): Promise<void> {
    const { swarmId, summary } = event.payload as { swarmId: string; summary: any };
    console.log(`[${this.agentId}] Swarm complete: ${swarmId}`, summary);
  }

  protected getLlmConfig(): { endpoint: string | null; apiKey: string | null } {
    return { endpoint: this.llmEndpoint, apiKey: this.llmApiKey };
  }
}
