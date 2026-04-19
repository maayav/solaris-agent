import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent } from '../events/types.js';

export interface CriticConfig extends AgentConfig {
  agentType: 'critic';
}

export class CriticAgent extends BaseAgent {
  constructor(config: CriticConfig) {
    super(config);
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);

    switch (event.type) {
      case 'exploit_failed':
        await this.handleExploitFailed(event);
        break;
      case 'finding_validated':
        await this.handleFindingValidated(event);
        break;
      default:
        console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
    }
  }

  private async handleExploitFailed(event: SwarmEvent): Promise<void> {
    const { missionId, error, target } = event.payload as {
      missionId: string;
      error: string;
      target: string;
    };
    console.log(`[${this.agentId}] Analyzing exploit failure: ${missionId} on ${target}`);

    const analysis = await this.analyzeFailure(missionId, target, error);
    await this.emit('failure_analysis_complete', { missionId, analysis });

    if (analysis.shouldRetry) {
      await this.emit('retry_recommended', { missionId, analysis });
    } else {
      await this.emit('abandon_recommended', { missionId, reason: analysis.reason });
    }
  }

  private async analyzeFailure(
    missionId: string,
    _target: string,
    error: string
  ): Promise<{ shouldRetry: boolean; reason?: string; alternative?: string }> {
    console.log(`[${this.agentId}] Analyzing failure for ${missionId}: ${error}`);
    return { shouldRetry: false, reason: 'unrecoverable' };
  }

  private async handleFindingValidated(event: SwarmEvent): Promise<void> {
    const { findingId, targetId, findingType } = event.payload as {
      findingId: string;
      targetId: string;
      findingType: string;
    };
    console.log(`[${this.agentId}] Reviewing validated finding: ${findingId} (${findingType})`);

    const review = await this.reviewFinding(findingId, targetId, findingType);
    if (!review.approved) {
      await this.emit('finding_rejected', { findingId, reason: review.reason });
    }
  }

  private async reviewFinding(
    findingId: string,
    _targetId: string,
    _findingType: string
  ): Promise<{ approved: boolean; reason?: string }> {
    console.log(`[${this.agentId}] Reviewing finding: ${findingId}`);
    return { approved: true };
  }
}
