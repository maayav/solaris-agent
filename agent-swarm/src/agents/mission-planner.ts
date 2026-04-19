import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent } from '../events/types.js';

export interface MissionPlannerConfig extends AgentConfig {
  agentType: 'mission_planner';
}

export class MissionPlannerAgent extends BaseAgent {
  constructor(config: MissionPlannerConfig) {
    super(config);
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);

    switch (event.type) {
      case 'finding_validated':
        await this.handleFindingValidated(event);
        break;
      case 'mission_queued':
        await this.handleMissionQueued(event);
        break;
      default:
        console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
    }
  }

  private async handleFindingValidated(event: SwarmEvent): Promise<void> {
    const { findingId, targetId, findingType, validated_by } = event.payload as {
      findingId: string;
      targetId: string;
      findingType: string;
      validated_by: string;
    };
    console.log(`[${this.agentId}] Finding validated: ${findingId} (${findingType}) by ${validated_by}`);

    const mission = await this.createMissionFromFinding(findingId, targetId, findingType);
    if (mission) {
      await this.emit('mission_queued', { missionId: mission.id, ...mission });
    }
  }

  private async createMissionFromFinding(
    findingId: string,
    _targetId: string,
    _findingType: string
  ): Promise<{ id: string } | null> {
    console.log(`[${this.agentId}] Creating mission from finding: ${findingId}`);
    const missionId = `mission_${Date.now()}`;
    return { id: missionId };
  }

  private async handleMissionQueued(event: SwarmEvent): Promise<void> {
    const { missionId, target, priority } = event.payload as {
      missionId: string;
      target: string;
      priority?: string;
    };
    console.log(`[${this.agentId}] Mission queued: ${missionId} for ${target} (priority: ${priority || 'normal'})`);
  }
}
