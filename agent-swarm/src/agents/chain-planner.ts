import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent } from '../events/types.js';

export interface ChainPlannerConfig extends AgentConfig {
  agentType: 'chain_planner';
}

export class ChainPlannerAgent extends BaseAgent {
  constructor(config: ChainPlannerConfig) {
    super(config);
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);

    switch (event.type) {
      case 'credential_found':
        await this.handleCredentialFound(event);
        break;
      case 'credential_promoted':
        await this.handleCredentialPromoted(event);
        break;
      case 'exploit_completed':
        await this.handleExploitCompleted(event);
        break;
      default:
        console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
    }
  }

  private async handleCredentialFound(event: SwarmEvent): Promise<void> {
    const { credentialId, targetId, credentialType, source } = event.payload as {
      credentialId: string;
      targetId: string;
      credentialType: string;
      source: string;
    };
    console.log(`[${this.agentId}] Credential found: ${credentialId} (${credentialType}) from ${source}`);

    const chain = await this.planCredentialChain(credentialId, targetId);
    if (chain.length > 0) {
      await this.emit('chain_planned', { credentialId, chain });
    }
  }

  private async planCredentialChain(credentialId: string, _targetId: string): Promise<string[]> {
    console.log(`[${this.agentId}] Planning credential chain for ${credentialId}`);
    return [];
  }

  private async handleCredentialPromoted(event: SwarmEvent): Promise<void> {
    const { credentialId, newLevel, promoted_by } = event.payload as {
      credentialId: string;
      newLevel: string;
      promoted_by: string;
    };
    console.log(`[${this.agentId}] Credential promoted: ${credentialId} to ${newLevel} by ${promoted_by}`);

    const newChain = await this.planNextChainStep(credentialId, newLevel);
    if (newChain.length > 0) {
      await this.emit('chain_extended', { credentialId, chain: newChain });
    }
  }

  private async planNextChainStep(credentialId: string, level: string): Promise<string[]> {
    console.log(`[${this.agentId}] Planning next chain step for ${credentialId} at level ${level}`);
    return [];
  }

  private async handleExploitCompleted(event: SwarmEvent): Promise<void> {
    const { missionId, result, targetId } = event.payload as {
      missionId: string;
      result: unknown;
      targetId: string;
    };
    console.log(`[${this.agentId}] Exploit completed: ${missionId} on ${targetId}`);

    const newCreds = await this.extractCredentials(missionId, result);
    for (const cred of newCreds) {
      await this.emit('credential_found', { ...cred, source: `chain_${missionId}` });
    }
  }

  private async extractCredentials(missionId: string, _result: unknown): Promise<Array<{
    credentialId: string;
    targetId: string;
    credentialType: string;
  }>> {
    console.log(`[${this.agentId}] Extracting credentials from mission: ${missionId}`);
    return [];
  }
}
