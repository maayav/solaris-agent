import { BaseAgent, type AgentConfig } from './base-agent.js';
import type { SwarmEvent } from '../events/types.js';
import { tavilySearch, nvdCveFetch, searchCisaKev } from '../utils/osint/index.js';
import { sectionNodeId } from '../infra/falkordb.js';
import { LLMRouter } from '../core/llm-router.js';
import type { LLMMessage } from '../core/providers/ollama.js';
import { parseOverlayPayloads } from '../utils/prompt-overlay.js';

export interface OsintConfig extends AgentConfig {
  agentType: 'osint';
}

export interface ExploitBrief {
  id: string;
  type: 'intel';
  subtype: 'exploit_brief';
  mission_id: string;
  exploit_type: string;
  target_component: string;
  technique_summary: string;
  working_examples: Array<{
    source: string;
    payload: string;
    context: string;
  }>;
  known_waf_bypasses: string[];
  common_failures: string[];
  lesson_refs: string[];
  osint_confidence: 'high' | 'medium' | 'low';
  created_at: number;
}

export interface IntelNode {
  id: string;
  type: 'intel';
  subtype: string;
  name: string;
  data: string;
  linked_vuln_class?: string;
  source: string;
  created_at: number;
  updated_at: number;
}

export class OsintAgent extends BaseAgent {
  private generatedBriefs = new Set<string>();
  private feedState: Record<string, number> = {};
  private llmRouter: LLMRouter;

  constructor(config: OsintConfig) {
    super(config);
    this.llmRouter = new LLMRouter();
  }

  async processEvent(event: SwarmEvent): Promise<void> {
    console.log(`[${this.agentId}] Processing event: ${event.type}`, event.payload);

    try {
      switch (event.type) {
        case 'mission_queued':
          await this.handleMissionQueued(event);
          break;
        case 'enrichment_requested':
          await this.handleEnrichmentRequested(event);
          break;
        case 'exploit_failed':
          await this.handleExploitFailed(event);
          break;
        case 'waf_duel_started':
          await this.handleWafDuelStarted(event);
          break;
        default:
          console.log(`[${this.agentId}] Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[${this.agentId}] Error processing event:`, error);
      this.handleError(error);
    }
  }

  async initializeFeeds(): Promise<void> {
    console.log(`[${this.agentId}] Initializing OSINT feeds...`);
    
    try {
      await this.ingestCisaKev();
      console.log(`[${this.agentId}] Feed initialization complete`);
    } catch (error) {
      console.error(`[${this.agentId}] Feed initialization failed:`, error);
    }
  }

  private async ingestCisaKev(): Promise<void> {
    console.log(`[${this.agentId}] Ingesting CISA KEV...`);
    
    try {
      const entries = await searchCisaKev('');
      console.log(`[${this.agentId}] CISA KEV: Found ${entries.length} known exploited vulnerabilities`);
      
      let written = 0;
      for (const entry of entries.slice(0, 100)) {
        const nodeId = sectionNodeId('intel', `kev:${entry.cveID}`);
        
        const nodeData = {
          id: nodeId,
          type: 'intel',
          subtype: 'cve_detail',
          name: entry.vulnerabilityName,
          data: JSON.stringify({
            cveID: entry.cveID,
            vendor: entry.vendorProject,
            product: entry.product,
            description: entry.shortDescription,
            knownRansomwareUse: entry.knownRansomwareCampaignUse,
            dueDate: entry.dueDate,
          }),
          linked_vuln_class: 'known_exploited',
          source: 'CISA KEV',
          created_at: Date.now(),
          updated_at: Date.now(),
        };

        await this.graph.upsertNode(nodeData);
        written++;
      }

      this.feedState['cisa_kev'] = Date.now();
      console.log(`[${this.agentId}] CISA KEV: Wrote ${written} nodes`);
    } catch (error) {
      console.error(`[${this.agentId}] CISA KEV ingestion failed:`, error);
    }
  }

  private async handleMissionQueued(event: SwarmEvent): Promise<void> {
    const { missionId, exploit_type, target_endpoint } = event.payload as {
      missionId: string;
      exploit_type: string;
      target_endpoint: string;
    };

    console.log(`[${this.agentId}] Generating ExploitBrief for mission: ${missionId}`);

    if (this.generatedBriefs.has(missionId)) {
      console.log(`[${this.agentId}] Brief already generated for ${missionId}, skipping`);
      return;
    }

    const brief = await this.generateExploitBrief(missionId, exploit_type, target_endpoint);
    
    if (brief) {
      await this.writeBriefToGraph(brief);
      this.generatedBriefs.add(missionId);
      
      await this.graph.updateNode(missionId, { brief_node_id: brief.id });
      
      await this.emit('brief_ready', { missionId, brief_node_id: brief.id });
      console.log(`[${this.agentId}] Brief ready: ${missionId} → ${brief.id}`);
    }
  }

private async generateExploitBrief(
    missionId: string,
    exploitType: string,
    targetEndpoint: string
  ): Promise<ExploitBrief | null> {
    console.log(`[${this.agentId}] Researching exploit for ${exploitType} targeting ${targetEndpoint}`);

    try {
      const searchResults = await tavilySearch({
        query: `${exploitType} exploit payload bypass techniques ${targetEndpoint}`,
        searchDepth: 'advanced',
        maxResults: 5,
      });

      const researchContext = this.buildResearchContext(searchResults);
      const systemPrompt = this.getSystemPrompt(exploitType);

      const briefSchema = {
        type: 'object',
        properties: {
          technique_summary: { type: 'string' },
          working_examples: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string' },
                payload: { type: 'string' },
                context: { type: 'string' },
              },
            },
          },
          known_waf_bypasses: { type: 'array', items: { type: 'string' } },
          common_failures: { type: 'array', items: { type: 'string' } },
          osint_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      };

      const MAX_RETRIES = 2;

      let parsedBrief: Record<string, unknown> | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          console.log(`[${this.agentId}] JSON parse retry ${attempt}/${MAX_RETRIES}`);
        }

        try {
          const userContent = this.buildBriefUserMessage(
            exploitType,
            targetEndpoint,
            researchContext,
            '',
            briefSchema
          );

          const messages: LLMMessage[] = [
            {
              role: 'system',
              content: systemPrompt || `You are OSINT, the intelligence gathering engine. Generate an ExploitBrief for a mission. Always respond with valid JSON.`,
            },
            {
              role: 'user',
              content: userContent,
            },
          ];

          const llmResponse = await this.llmRouter.complete('osint', messages, { schema: briefSchema });

          const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsedBrief = JSON.parse(jsonMatch[0]);
            console.log(`[${this.agentId}] JSON parsed successfully on attempt ${attempt + 1}`);
            break;
          }
        } catch (parseError) {
          console.warn(`[${this.agentId}] Attempt ${attempt + 1} failed:`, parseError instanceof Error ? parseError.message : String(parseError));
        }
      }

      const normalizedType = exploitType.toLowerCase().replace(/\s+/g, '_');
      const payloadLibNodeId = await this.storePayloadLibrary(normalizedType);
      const lessonRefs = payloadLibNodeId ? [payloadLibNodeId] : [];

      const brief: ExploitBrief = {
        id: sectionNodeId('intel', `brief:mission:${missionId}`),
        type: 'intel',
        subtype: 'exploit_brief',
        mission_id: missionId,
        exploit_type: exploitType,
        target_component: targetEndpoint,
        technique_summary: parsedBrief?.technique_summary as string || searchResults.answer || `Exploitation techniques for ${exploitType}`,
        working_examples: (parsedBrief?.working_examples as ExploitBrief['working_examples']) || [],
        known_waf_bypasses: (parsedBrief?.known_waf_bypasses as string[]) || [],
        common_failures: (parsedBrief?.common_failures as string[]) || [],
        lesson_refs: lessonRefs,
        osint_confidence: (parsedBrief?.osint_confidence as 'high' | 'medium' | 'low') || (searchResults.answer ? 'high' : 'medium'),
        created_at: Date.now(),
      };

      return brief;
    } catch (error) {
      console.error(`[${this.agentId}] Brief generation failed:`, error);
      return null;
    }
  }

  private buildBriefUserMessage(
    exploitType: string,
    targetEndpoint: string,
    researchContext: string,
    _overlay: string,
    schema: object
  ): string {
    const parts: string[] = [];

    parts.push(`Generate an ExploitBrief for:
- Exploit Type: ${exploitType}
- Target: ${targetEndpoint}

Research Results (from live OSINT):
${researchContext}

IMPORTANT: Do NOT include actual payloads in your response. Payloads are stored separately in the graph and will be retrieved at execution time.

Respond with ONLY valid JSON matching this schema:
${JSON.stringify(schema, null, 2)}`);

    return parts.join('\n');
  }

  private buildResearchContext(searchResults: Awaited<ReturnType<typeof tavilySearch>>): string {
    const parts: string[] = [];

    if (searchResults.answer) {
      parts.push(`AI Summary:\n${searchResults.answer}\n`);
    }

    parts.push('Web Sources:');
    for (const result of searchResults.results.slice(0, 5)) {
      parts.push(`- [${result.title}](${result.url}): ${result.content.slice(0, 300)}...`);
    }

    return parts.join('\n');
  }

  private async writeBriefToGraph(brief: ExploitBrief): Promise<void> {
    const nodeData = {
      id: brief.id,
      type: brief.type,
      subtype: brief.subtype,
      mission_id: brief.mission_id,
      exploit_type: brief.exploit_type,
      target_component: brief.target_component,
      technique_summary: brief.technique_summary,
      working_examples: JSON.stringify(brief.working_examples),
      known_waf_bypasses: JSON.stringify(brief.known_waf_bypasses),
      common_failures: JSON.stringify(brief.common_failures),
      lesson_refs: JSON.stringify(brief.lesson_refs),
      osint_confidence: brief.osint_confidence,
      created_at: brief.created_at,
    };

    await this.graph.upsertNode(nodeData);
  }

  private async handleEnrichmentRequested(event: SwarmEvent): Promise<void> {
    const { target_id, enrichment_type } = event.payload as {
      target_id: string;
      enrichment_type: 'cve' | 'technique' | 'exploitdb' | 'osint';
    };

    console.log(`[${this.agentId}] Enrichment requested: ${target_id} (${enrichment_type})`);

    let nodesWritten = 0;

    try {
      switch (enrichment_type) {
        case 'cve':
          nodesWritten = await this.enrichWithCVE(target_id);
          break;
        case 'technique':
          nodesWritten = await this.enrichWithTechnique(target_id);
          break;
        case 'exploitdb':
          nodesWritten = await this.enrichWithExploitDB(target_id);
          break;
        case 'osint':
          nodesWritten = await this.enrichWithOSINT(target_id);
          break;
      }

      await this.emit('finding_written', {
        target_id,
        finding_type: 'osint',
        enrichment_type,
        nodes_written: nodesWritten,
      });

      await this.emit('enrichment_complete', {
        target_id,
        enrichment_type,
        nodes_written: nodesWritten,
      });

      console.log(`[${this.agentId}] Enrichment complete: ${target_id} (${nodesWritten} nodes)`);
    } catch (error) {
      console.error(`[${this.agentId}] Enrichment failed:`, error);
    }
  }

  private async enrichWithCVE(cveId: string): Promise<number> {
    const cve = await nvdCveFetch(cveId);
    
    const nodeId = sectionNodeId('intel', `cve:${cveId}`);
    
    const nodeData = {
      id: nodeId,
      type: 'intel',
      subtype: 'cve_detail',
      name: cve.id,
      data: JSON.stringify({
        description: cve.description,
        severity: cve.severity,
        cvssScore: cve.baseScore,
        cvssVector: cve.cvssVector,
        references: cve.references,
        affectedProducts: cve.affectedProducts,
      }),
      linked_vuln_class: cve.severity.toLowerCase(),
      source: 'NVD',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await this.graph.upsertNode(nodeData);
    return 1;
  }

  private async enrichWithTechnique(technique: string): Promise<number> {
    const searchResults = await tavilySearch({
      query: `${technique} attack technique mitigation prevention`,
      searchDepth: 'advanced',
      maxResults: 5,
    });

    const researchContext = this.buildResearchContext(searchResults);
    const systemPrompt = this.getSystemPrompt(technique);
    const normalizedType = technique.toLowerCase().replace(/\s+/g, '_');

    const techniqueSchema = {
      type: 'object',
      properties: {
        description: { type: 'string' },
        mitigation: { type: 'string' },
        detection: { type: 'string' },
      },
    };

    try {
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: systemPrompt || `You are OSINT, the intelligence gathering engine. Document attack/defense techniques. Always respond with valid JSON matching the schema. Do NOT include actual payloads in your response.`,
        },
        {
          role: 'user',
          content: `Document the technique: ${technique}

Research (from live OSINT):
${researchContext}

IMPORTANT: Do NOT include actual payloads in your response. Only provide description, mitigation, and detection guidance.

Schema:
${JSON.stringify(techniqueSchema, null, 2)}`,
        },
      ];

      const llmResponse = await this.llmRouter.complete('osint', messages, { schema: techniqueSchema });

      let parsedTechnique;
      try {
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedTechnique = JSON.parse(jsonMatch[0]);
        }
      } catch {
        console.warn(`[${this.agentId}] Failed to parse technique JSON`);
      }

      const payloadLibNodeId = await this.storePayloadLibrary(normalizedType);

      const nodeId = sectionNodeId('intel', `technique:${normalizedType}`);
      
      const nodeData = {
        id: nodeId,
        type: 'intel',
        subtype: 'technique_doc',
        name: technique,
        data: JSON.stringify({
          summary: parsedTechnique?.description || searchResults.answer,
          mitigation: parsedTechnique?.mitigation,
          detection: parsedTechnique?.detection,
          sources: searchResults.sources,
          relatedTechniques: searchResults.results.slice(0, 3).map(r => r.title),
          payload_library_id: payloadLibNodeId,
        }),
        source: 'OSINT',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await this.graph.upsertNode(nodeData);
      return 1;
    } catch (error) {
      console.error(`[${this.agentId}] Technique enrichment failed:`, error);
      return 0;
    }
  }

  private async storePayloadLibrary(exploitType: string): Promise<string | null> {
    const overlayPayloads = parseOverlayPayloads(exploitType);
    
    if (overlayPayloads.length === 0) {
      console.log(`[${this.agentId}] No payload library found for ${exploitType}`);
      return null;
    }

    const nodeId = sectionNodeId('intel', `payloads:${exploitType}`);
    
    const nodeData = {
      id: nodeId,
      type: 'intel',
      subtype: 'payload_library',
      name: `${exploitType} payloads`,
      data: JSON.stringify({
        exploit_type: exploitType,
        payloads: overlayPayloads,
        stored_at: Date.now(),
      }),
      source: 'payload_overlay',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    try {
      await this.graph.upsertNode(nodeData);
      console.log(`[${this.agentId}] Stored payload library: ${nodeId} (${overlayPayloads.length} categories)`);
      return nodeId;
    } catch (error) {
      console.error(`[${this.agentId}] Failed to store payload library:`, error);
      return null;
    }
  }

  private async enrichWithExploitDB(query: string): Promise<number> {
    const searchResults = await tavilySearch({
      query: `${query} exploit proof of concept CVE`,
      searchDepth: 'basic',
      maxResults: 10,
    });

    let count = 0;
    for (const result of searchResults.results) {
      const nodeId = sectionNodeId('intel', `exploitdb:${result.title.replace(/\s+/g, '_').slice(0, 50)}`);
      
      const nodeData = {
        id: nodeId,
        type: 'intel',
        subtype: 'exploit_brief',
        name: result.title,
        data: JSON.stringify({
          description: result.content,
          source: result.url,
        }),
        source: 'Exploit-DB',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await this.graph.upsertNode(nodeData);
      count++;
    }

    return count;
  }

  private async enrichWithOSINT(target: string): Promise<number> {
    const searchResults = await tavilySearch({
      query: `${target} security vulnerabilities misconfiguration`,
      searchDepth: 'advanced',
      maxResults: 5,
    });

    const nodeId = sectionNodeId('intel', `osint:${target.replace(/\s+/g, '_').slice(0, 50)}`);
    
    const nodeData = {
      id: nodeId,
      type: 'intel',
      subtype: 'osint',
      name: `OSINT for ${target}`,
      data: JSON.stringify({
        summary: searchResults.answer,
        findings: searchResults.results,
      }),
      source: 'Tavily',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await this.graph.upsertNode(nodeData);
    return 1;
  }

  private async handleExploitFailed(event: SwarmEvent): Promise<void> {
    const { mission_id, failure_class, exploit_type, target_id } = event.payload as {
      mission_id: string;
      failure_class: string;
      exploit_type: string;
      target_id: string;
    };

    console.log(`[${this.agentId}] researching bypass for ${exploit_type} (${failure_class})`);

    try {
      const supplementaryBrief = await this.generateSupplementaryBrief(
        mission_id,
        exploit_type,
        failure_class,
        target_id
      );

      if (supplementaryBrief) {
        await this.writeBriefToGraph(supplementaryBrief);
        console.log(`[${this.agentId}] Supplementary brief written for ${mission_id}`);
      }
    } catch (error) {
      console.error(`[${this.agentId}] Supplementary brief generation failed:`, error);
    }
  }

  private async generateSupplementaryBrief(
    missionId: string,
    exploitType: string,
    failureClass: string,
    targetId: string
  ): Promise<ExploitBrief | null> {
    const searchQuery = `${exploitType} bypass ${failureClass} techniques`;
    
    try {
      const searchResults = await tavilySearch({
        query: searchQuery,
        searchDepth: 'advanced',
        maxResults: 5,
      });

      const workingExamples: ExploitBrief['working_examples'] = [];
      
      for (const result of searchResults.results.slice(0, 3)) {
        workingExamples.push({
          source: result.title,
          payload: result.content.slice(0, 200),
          context: `Bypass technique for ${failureClass}: ${result.url}`,
        });
      }

      return {
        id: sectionNodeId('intel', `brief:supplementary:${missionId}`),
        type: 'intel',
        subtype: 'exploit_brief',
        mission_id: missionId,
        exploit_type: exploitType,
        target_component: targetId,
        technique_summary: searchResults.answer || `Bypass techniques for ${failureClass}`,
        working_examples: workingExamples,
        known_waf_bypasses: [],
        common_failures: [failureClass],
        lesson_refs: [],
        osint_confidence: 'high',
        created_at: Date.now(),
      };
    } catch (error) {
      console.error(`[${this.agentId}] Supplementary brief search failed:`, error);
      return null;
    }
  }

  private async handleWafDuelStarted(event: SwarmEvent): Promise<void> {
    const { duel_id, waf_type, target_id } = event.payload as {
      duel_id: string;
      target_id: string;
      waf_type: string;
    };

    console.log(`[${this.agentId}] Gathering WAF bypass intel for ${waf_type}`);

    try {
      const wafIntel = await this.gatherWafBypassIntel(waf_type, target_id);
      
      const nodeId = sectionNodeId('intel', `waf:${duel_id}`);
      
      const nodeData = {
        id: nodeId,
        type: 'intel',
        subtype: 'waf_bypass',
        name: `WAF Intel: ${waf_type}`,
        data: JSON.stringify(wafIntel),
        source: 'OSINT',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await this.graph.upsertNode(nodeData);

      await this.emit('finding_written', {
        target_id: duel_id,
        finding_type: 'waf_intel',
        waf_type,
        data: wafIntel,
      });

      console.log(`[${this.agentId}] WAF intel gathered: ${waf_type}`);
    } catch (error) {
      console.error(`[${this.agentId}] WAF intel gathering failed:`, error);
    }
  }

  private async gatherWafBypassIntel(wafType: string, _targetId?: string): Promise<Record<string, unknown>> {
    const searchResults = await tavilySearch({
      query: `${wafType} WAF bypass techniques evasion`,
      searchDepth: 'advanced',
      maxResults: 5,
    });

    return {
      waf_type: wafType,
      summary: searchResults.answer,
      techniques: searchResults.results.map(r => ({
        title: r.title,
        description: r.content.slice(0, 300),
        source: r.url,
      })),
      gathered_at: Date.now(),
    };
  }
}
