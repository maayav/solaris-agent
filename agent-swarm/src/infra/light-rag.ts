import { FalkorDBClient, getFalkorDB, type GraphSection } from './falkordb.js';
import { embeddingService } from './embeddings.js';

export interface RAGQuery {
  section: GraphSection;
  queryText: string;
  limit?: number;
  filter?: Record<string, unknown>;
}

export interface RAGResult {
  nodeId: string;
  score: number;
  node: Record<string, unknown>;
}

export interface SectionalConfig {
  vectorProperty: string;
  textProperties: string[];
  indexName: string;
}

const SECTION_CONFIGS: Record<GraphSection, SectionalConfig> = {
  recon: {
    vectorProperty: 'embedding',
    textProperties: ['url', 'path', 'description', 'vuln_class', 'name'],
    indexName: 'recon_rag_index',
  },
  gamma: {
    vectorProperty: 'embedding',
    textProperties: ['exploit_type', 'payload', 'target_endpoint', 'evidence'],
    indexName: 'gamma_rag_index',
  },
  bridge: {
    vectorProperty: 'embedding',
    textProperties: ['name', 'content_type', 'path'],
    indexName: 'bridge_rag_index',
  },
  intel: {
    vectorProperty: 'payload_embedding',
    textProperties: ['name', 'data', 'technique_summary', 'exploit_type'],
    indexName: 'intel_rag_index',
  },
  lessons: {
    vectorProperty: 'embedding',
    textProperties: ['exploit_type', 'failure_class', 'delta', 'tags'],
    indexName: 'lessons_rag_index',
  },
};

const EMBEDDING_DIMENSIONS = 1024;

export class LightRAG {
  private graph: FalkorDBClient;
  private initialized = false;

  constructor(graph?: FalkorDBClient) {
    this.graph = graph || getFalkorDB();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    for (const [section, config] of Object.entries(SECTION_CONFIGS)) {
      await this.ensureIndex(section as GraphSection, config.indexName, SECTION_CONFIGS[section as GraphSection].vectorProperty);
    }

    this.initialized = true;
  }

  private async ensureIndex(section: GraphSection, indexName: string, vectorProperty: string): Promise<void> {
    try {
      await this.graph.createVectorIndex(indexName, `${section}_node`, vectorProperty, EMBEDDING_DIMENSIONS, 'COS');
    } catch {
      // Index might already exist
    }
  }

  private sectionPrefix(section: GraphSection, nodeId: string): string {
    return `${section}/${nodeId}`;
  }

  async indexNode(
    section: GraphSection,
    nodeId: string,
    properties: Record<string, unknown>
  ): Promise<void> {
    const config = SECTION_CONFIGS[section];
    const textContent = config.textProperties
      .map(prop => {
        const value = properties[prop];
        return value ? String(value) : '';
      })
      .filter(Boolean)
      .join(' ');

    if (!textContent) return;

    const { embedding } = await embeddingService.embed(textContent);
    
    const prefixedId = this.sectionPrefix(section, nodeId);
    
    const updateProps = {
      ...properties,
      [config.vectorProperty]: JSON.stringify(embedding),
    };

    await this.graph.updateNode(prefixedId, updateProps);
  }

  async query(query: RAGQuery): Promise<RAGResult[]> {
    const config = SECTION_CONFIGS[query.section];
    const { embedding } = await embeddingService.embed(query.queryText);
    
    const limit = query.limit || 10;

    const filterConditions: string[] = [];
    if (query.filter) {
      for (const [key, value] of Object.entries(query.filter)) {
        filterConditions.push(`n.${key} = ${this.graphEscape(value)}`);
      }
    }

    const whereClause = filterConditions.length > 0 
      ? `WHERE ${filterConditions.join(' AND ')}` 
      : '';

    const cypher = `
      MATCH (n:${query.section}_node)
      ${whereClause}
      WITH n, n.${config.vectorProperty} as vec
      WHERE vec IS NOT NULL
      WITH n, vec
      ORDER BY vec <-> '${JSON.stringify(embedding)}' ASC
      LIMIT ${limit}
      RETURN n.id as nodeId, n
    `;

    const results = await this.graph.rawQuery(cypher);
    if (!results[1]) return [];

    const ragResults: RAGResult[] = [];
    
    for (const row of results[1]) {
      const nodeId = row[0];
      const node = row[1];
      
      const storedEmbedding = node[config.vectorProperty];
      let score = 0;
      
      if (storedEmbedding) {
        const stored = typeof storedEmbedding === 'string' 
          ? JSON.parse(storedEmbedding) 
          : storedEmbedding;
        score = embeddingService.cosineSimilarity(embedding, stored);
      }

      ragResults.push({
        nodeId,
        score,
        node: node as Record<string, unknown>,
      });
    }

    return ragResults;
  }

  async queryHybrid(
    section: GraphSection,
    queryText: string,
    cypherFilter: string,
    limit = 10
  ): Promise<RAGResult[]> {
    const config = SECTION_CONFIGS[section];
    const { embedding } = await embeddingService.embed(queryText);

    const cypher = `
      MATCH (n:${section}_node)
      WHERE ${cypherFilter}
      WITH n, n.${config.vectorProperty} as vec
      WHERE vec IS NOT NULL
      WITH n, vec
      ORDER BY vec <-> '${JSON.stringify(embedding)}' ASC
      LIMIT ${limit}
      RETURN n.id as nodeId, n
    `;

    const results = await this.graph.rawQuery(cypher);
    if (!results[1]) return [];

    const ragResults: RAGResult[] = [];
    
    for (const row of results[1]) {
      const nodeId = row[0];
      const node = row[1];
      
      const storedEmbedding = node[config.vectorProperty];
      let score = 0;
      
      if (storedEmbedding) {
        const stored = typeof storedEmbedding === 'string' 
          ? JSON.parse(storedEmbedding) 
          : storedEmbedding;
        score = embeddingService.cosineSimilarity(embedding, stored);
      }

      ragResults.push({
        nodeId,
        score,
        node: node as Record<string, unknown>,
      });
    }

    return ragResults;
  }

  async reindexSection(section: GraphSection): Promise<number> {
    const config = SECTION_CONFIGS[section];
    const cypher = `MATCH (n:${section}_node) RETURN n.id as id, n`;
    
    const results = await this.graph.rawQuery(cypher);
    if (!results[1]) return 0;

    let count = 0;
    for (const row of results[1]) {
      const nodeId = row[0];
      const node = row[1];
      
      const textContent = config.textProperties
        .map(prop => {
          const value = node[prop];
          return value ? String(value) : '';
        })
        .filter(Boolean)
        .join(' ');

      if (textContent) {
        const { embedding } = await embeddingService.embed(textContent);
        await this.graph.updateNode(nodeId as string, {
          [config.vectorProperty]: JSON.stringify(embedding),
        });
        count++;
      }
    }

    return count;
  }

  private graphEscape(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
    return `'${JSON.stringify(value).replace(/'/g, "\\'")}'`;
  }
}

export const lightRAG = new LightRAG();