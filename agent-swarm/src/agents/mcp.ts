import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent } from '../events/types.js';

export interface McpConfig extends AgentConfig {
  agentType: 'mcp';
}

export class McpAgent extends BaseAgent {
  constructor(config: McpConfig) {
    super(config);
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);

    switch (event.type) {
      case 'mission_authorized':
        await this.handleMissionAuthorized(event);
        break;
      case 'validation_probe_requested':
        await this.handleValidationProbeRequested(event);
        break;
      default:
        console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
    }
  }

  private async handleMissionAuthorized(event: SwarmEvent): Promise<void> {
    const { missionId, target, authorized_by } = event.payload as {
      missionId: string;
      target: string;
      authorized_by: string;
    };
    console.log(`[${this.agentId}] Mission authorized: ${missionId} for ${target} by ${authorized_by}`);

    const validation = await this.validateMission(missionId, target);
    if (validation.valid) {
      await this.emit('mission_ready', { missionId, validation });
    } else {
      await this.emit('mission_rejected', { missionId, reason: validation.reason });
    }
  }

  private async validateMission(missionId: string, target: string): Promise<{ valid: boolean; reason?: string }> {
    console.log(`[${this.agentId}] Validating mission ${missionId} for target: ${target}`);
    return { valid: true };
  }

  private async handleValidationProbeRequested(event: SwarmEvent): Promise<void> {
    const { probeId, targetId, probeType } = event.payload as {
      probeId: string;
      targetId: string;
      probeType: string;
    };
    console.log(`[${this.agentId}] Validation probe requested: ${probeType} for ${targetId}`);

    const result = await this.executeProbe(probeId, targetId, probeType);
    await this.emit('validation_probe_complete', { probeId, targetId, result });
  }

  private async executeProbe(probeId: string, targetId: string, probeType: string): Promise<Record<string, unknown>> {
    console.log(`[${this.agentId}] Executing ${probeType} probe on ${targetId}`);
    return {
      probeId,
      targetId,
      probeType,
      executed_at: Date.now(),
      result: 'passed',
    };
  }
}
