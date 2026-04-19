import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent } from '../events/types.js';

export interface VerifierConfig extends AgentConfig {
  agentType: 'verifier';
  validationRules?: Record<string, unknown>;
}

export class VerifierAgent extends BaseAgent {
  constructor(config: VerifierConfig) {
    super(config);
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);
    
    switch (event.type) {
      case 'finding_written':
        await this.handleFindingWritten(event);
        break;
      case 'credential_found':
        await this.handleCredentialFound(event);
        break;
      case 'enrichment_requested':
        await this.handleEnrichmentRequested(event);
        break;
      default:
        console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
    }
  }

  private async handleFindingWritten(event: SwarmEvent): Promise<void> {
    const { findingId, severity, confidence } = event.payload as {
      findingId: string;
      severity: string;
      confidence: number;
    };
    
    console.log(`[${this.agentId}] Validating finding: ${findingId}`);
    
    const isValid = this.validateFinding({ findingId, severity, confidence });
    
    if (isValid) {
      await this.emit('finding_validated', { findingId, validated: true });
    }
  }

  private async handleCredentialFound(event: SwarmEvent): Promise<void> {
    const { credentialId, platform } = event.payload as {
      credentialId: string;
      platform: string;
    };
    
    console.log(`[${this.agentId}] Validating credential: ${credentialId}`);
    
    const isValid = this.validateCredential({ credentialId, platform });
    
    if (isValid) {
      await this.emit('credential_promoted', { credentialId, validated: true });
    }
  }

  private async handleEnrichmentRequested(event: SwarmEvent): Promise<void> {
    const { findingId, enrichmentType } = event.payload as {
      findingId: string;
      enrichmentType: string;
    };
    
    console.log(`[${this.agentId}] Processing enrichment request: ${findingId} (${enrichmentType})`);
  }

  private validateFinding(data: { findingId: string; severity: string; confidence: number }): boolean {
    if (data.confidence < 0.5) return false;
    if (!['critical', 'high', 'medium', 'low', 'info'].includes(data.severity)) return false;
    return true;
  }

  private validateCredential(data: { credentialId: string; platform: string }): boolean {
    if (!data.credentialId.startsWith('cred:')) return false;
    if (!data.platform) return false;
    return true;
  }
}
