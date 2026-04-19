import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent } from '../events/types.js';

export interface ReportAgentConfig extends AgentConfig {
  agentType: 'report_agent';
}

export class ReportAgent extends BaseAgent {
  constructor(config: ReportAgentConfig) {
    super(config);
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);

    switch (event.type) {
      case 'swarm_complete':
        await this.handleSwarmComplete(event);
        break;
      case 'finding_written':
        await this.handleFindingWritten(event);
        break;
      default:
        console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
    }
  }

  private async handleSwarmComplete(event: SwarmEvent): Promise<void> {
    const { swarmId, summary } = event.payload as {
      swarmId: string;
      summary: {
        missionCount: number;
        successCount: number;
        failureCount: number;
        duration: number;
      };
    };
    console.log(`[${this.agentId}] Swarm complete: ${swarmId}`);

    const report = await this.generateReport(swarmId, summary);
    await this.emit('report_generated', { swarmId, report });
  }

  private async generateReport(
    swarmId: string,
    summary: { missionCount: number; successCount: number; failureCount: number; duration: number }
  ): Promise<Record<string, unknown>> {
    console.log(`[${this.agentId}] Generating report for swarm: ${swarmId}`);

    const findings = await this.graph.findNodesByLabel('finding');
    const credentials = await this.graph.findNodesByLabel('credential');

    return {
      swarmId,
      generated_at: Date.now(),
      summary: {
        ...summary,
        total_findings: findings.length,
        total_credentials: credentials.length,
      },
      findings: findings,
      credentials: credentials,
    };
  }

  private async handleFindingWritten(event: SwarmEvent): Promise<void> {
    const { targetId, type } = event.payload as {
      targetId: string;
      type: string;
      data: unknown;
    };
    console.log(`[${this.agentId}] Finding recorded: ${type} for ${targetId}`);
  }
}
