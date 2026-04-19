import Redis from 'ioredis';
import { getConfig } from '../config/index.js';

export interface FalkorDBConfig {
  host: string;
  port: number;
  password?: string;
  graphName?: string;
}

const GRAPH_NAME = 'solaris';

export type GraphSection = 'recon' | 'gamma' | 'bridge' | 'intel' | 'lessons';

export const SECTION_PREFIXES: Record<GraphSection, string> = {
  recon: 'recon/',
  gamma: 'gamma/',
  bridge: 'bridge/',
  intel: 'intel/',
  lessons: 'lessons/',
};

export function sectionNodeId(section: GraphSection, nodeId: string): string {
  return `${SECTION_PREFIXES[section]}${nodeId}`;
}

export function parseSectionNodeId(fullId: string): { section: GraphSection; nodeId: string } | null {
  for (const [section, prefix] of Object.entries(SECTION_PREFIXES)) {
    if (fullId.startsWith(prefix)) {
      return {
        section: section as GraphSection,
        nodeId: fullId.slice(prefix.length),
      };
    }
  }
  return null;
}

export class FalkorDBClient {
  private redis: Redis;
  private graphName: string;

  constructor(config: FalkorDBConfig) {
    this.graphName = config.graphName || GRAPH_NAME;
    this.redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  private async graphQuery(cypher: string): Promise<any[]> {
    return this.redis.call(
      'GRAPH.QUERY',
      this.graphName,
      cypher
    ) as Promise<any[]>;
  }

  async createNode(
    label: string,
    id: string,
    properties: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const props = {
      id,
      ...properties,
      created_at: Date.now(),
    };

    const propSet = Object.entries(props)
      .map(([k, v]) => `n.${k} = ${this.escapeValue(v)}`)
      .join(', ');

    const cypher = `MERGE (n:${label} {id: ${this.escapeValue(id)}}) SET ${propSet} RETURN n`;

    const result = await this.graphQuery(cypher);
    return this.parseNodeResult(result);
  }

  async updateNode(
    id: string,
    properties: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const props = {
      ...properties,
      updated_at: Date.now(),
    };

    const propSet = Object.entries(props)
      .map(([k, v]) => `n.${k} = ${this.escapeValue(v)}`)
      .join(', ');

    const cypher = `MATCH (n) WHERE n.id = ${this.escapeValue(id)} SET ${propSet} RETURN n`;

    const result = await this.graphQuery(cypher);
    return this.parseNodeResult(result);
  }

  async upsertNode(nodeData: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const { id, type, ...properties } = nodeData;
    if (!id || !type) {
      throw new Error('upsertNode requires id and type properties');
    }

    const label = type === 'intel' ? 'IntelNode' : `${type}Node`;
    return this.createNode(label, id as string, properties);
  }

  async deleteNode(id: string): Promise<boolean> {
    const cypher = `MATCH (n) WHERE n.id = ${this.escapeValue(id)} DETACH DELETE n RETURN count(n) as deleted`;
    const result = await this.graphQuery(cypher);
    const deleted = result[1]?.[0]?.[0] || 0;
    return deleted > 0;
  }

  async findNodeById<T>(id: string): Promise<T | null> {
    const cypher = `MATCH (n) WHERE n.id = ${this.escapeValue(id)} RETURN n`;
    const result = await this.graphQuery(cypher);
    return this.parseNodeResult(result) as T | null;
  }

  async findNodesByLabel<T>(
    label: string,
    filter?: Record<string, unknown>
  ): Promise<T[]> {
    let cypher = `MATCH (n:${label})`;

    if (filter && Object.keys(filter).length > 0) {
      const conditions = Object.entries(filter)
        .map(([key, value]) => `n.${key} = ${this.escapeValue(value)}`);
      cypher += ` WHERE ${conditions.join(' AND ')}`;
    }

    cypher += ' RETURN n';

    const result = await this.graphQuery(cypher);
    return this.parseNodeResults(result) as T[];
  }

  // ===========================================
  // Edge Operations
  // ===========================================

  async createEdge(
    fromId: string,
    toId: string,
    edgeType: string,
    properties?: Record<string, unknown>
  ): Promise<void> {
    const propSet = properties
      ? Object.entries(properties)
          .map(([k, v]) => `r.${k} = ${this.escapeValue(v)}`)
          .join(', ')
      : '';

    const cypher = propSet
      ? `MATCH (from) WHERE from.id = ${this.escapeValue(fromId)} MATCH (to) WHERE to.id = ${this.escapeValue(toId)} CREATE (from)-[r:${edgeType}]->(to) SET ${propSet}`
      : `MATCH (from) WHERE from.id = ${this.escapeValue(fromId)} MATCH (to) WHERE to.id = ${this.escapeValue(toId)} CREATE (from)-[r:${edgeType}]->(to)`;

    await this.graphQuery(cypher);
  }

  async findEdges(
    fromId: string,
    edgeType?: string
  ): Promise<string[]> {
    const edgeLabel = edgeType ? `:${edgeType}` : '';
    const cypher = `MATCH (from)-[r${edgeLabel}]->(to) WHERE from.id = ${this.escapeValue(fromId)} RETURN to.id as targetId`;

    const result = await this.graphQuery(cypher);
    // Edge results: result[0] = column names, result[1] = rows
    if (!result[1] || !Array.isArray(result[1])) return [];
    return result[1].map((row: any) => row[0]);
  }

  async findEdgeWithProps(
    fromId: string,
    toId: string,
    edgeType: string
  ): Promise<Record<string, unknown> | null> {
    const cypher = `MATCH (from)-[r:${edgeType}]->(to) WHERE from.id = ${this.escapeValue(fromId)} AND to.id = ${this.escapeValue(toId)} RETURN r`;

    const result = await this.graphQuery(cypher);
    // Edge properties are returned as array of [key, value] pairs
    const edgeData = result[1]?.[0];
    if (!edgeData) return null;
    
    const props = edgeData[0];
    if (!Array.isArray(props)) return null;
    
    const obj: Record<string, unknown> = {};
    for (const [key, value] of props) {
      obj[key] = value;
    }
    return obj;
  }

  // ===========================================
  // Graph Traversal
  // ===========================================

  async traverse(
    startId: string,
    edgeTypes: string[],
    depth: number = 3
  ): Promise<string[]> {
    // edgeTypes already include the type names, just join them
    // The [:type*1..N] syntax requires just the type name
    const edgePattern = edgeTypes.join('|');
    const cypher = `MATCH path = (start)-[:${edgePattern}*1..${depth}]->(end) WHERE start.id = ${this.escapeValue(startId)} WITH nodes(path) as ns UNWIND ns as n RETURN DISTINCT n.id as id`;

    const result = await this.graphQuery(cypher);
    if (!result[1]) return [];
    return result[1].map((row: any) => row[0]);
  }

  async getContext(nodeId: string, depth: number = 2): Promise<Record<string, unknown>> {
    const cypher = `MATCH (center) WHERE center.id = ${this.escapeValue(nodeId)} OPTIONAL MATCH path = (center)-[*1..${depth}]-(neighbor) WITH center, collect(DISTINCT neighbor) as neighbors RETURN center, neighbors`;

    const result = await this.graphQuery(cypher);
    return result[1]?.[0] || null;
  }

  // ===========================================
  // Vector Index Operations (Light RAG)
  // ===========================================

  async createVectorIndex(
    indexName: string,
    label: string,
    property: string,
    dimensions: number = 1024,
    algorithm: 'COS' | 'IP' | 'L2' = 'COS'
  ): Promise<void> {
    const cypher = `CALL db.idx.vector.createNodeIndex('${indexName}', '${label}', '${property}', ${dimensions}, '${algorithm}')`;
    await this.graphQuery(cypher);
  }

  async dropIndex(indexName: string): Promise<void> {
    const cypher = `CALL db.idx.vector.drop('${indexName}')`;
    await this.graphQuery(cypher);
  }

  async listIndexes(): Promise<string[]> {
    const cypher = 'CALL db.indexes()';
    const result = await this.graphQuery(cypher);
    if (!result[1]) return [];
    return result[1].map((row: any) => row[0]);
  }

  async queryVectorIndex(
    indexName: string,
    embedding: number[],
    limit: number = 10,
    options?: { where?: string; yield?: string }
  ): Promise<Array<{ node: Record<string, unknown>; score?: number }>> {
    const embeddingStr = JSON.stringify(embedding);
    const yieldClause = options?.yield ? `YIELD ${options.yield}` : '';
    const whereClause = options?.where ? `WHERE ${options.where}` : '';

    const cypher = `
      CALL db.idx.vector.queryNodes('${indexName}', ${limit}, '${embeddingStr}')
      ${yieldClause}
      ${yieldClause ? whereClause : 'WHERE true'}
      RETURN node, score
    `.trim();

    const result = await this.graphQuery(cypher);
    if (!result[1]) return [];

    return result[1].map((row: any) => ({
      node: row[0] || {},
      score: row[1],
    }));
  }

  // ===========================================
  // Mission Queue (Atomic Claim with Redis Lock)
  // ===========================================

  async claimMission(
    executorType: string,
    agentId: string
  ): Promise<string | null> {
    // Find unclaimed mission - use simpler query without NOT EXISTS
    const findCypher = `MATCH (m:Mission {status: 'queued', verified: true, authorized: true, executor: ${this.escapeValue(executorType)}}) RETURN m.id as id ORDER BY m.priority DESC, m.created_at ASC LIMIT 1`;

    const findResult = await this.graphQuery(findCypher);
    const missionId = findResult[1]?.[0]?.[0];
    if (!missionId) return null;

    // Try to acquire Redis lock for this mission
    const acquired = await this.redis.setnx(`claim:${missionId}`, agentId);
    if (!acquired) return null;

    // Set TTL on lock (5 minutes)
    await this.redis.expire(`claim:${missionId}`, 300);

    // Update mission status
    const updateCypher = `MATCH (m:Mission {id: ${this.escapeValue(missionId)}}) SET m.status = 'active', m.claimed_by = ${this.escapeValue(agentId)}, m.updated_at = ${Date.now()} RETURN m`;

    await this.graphQuery(updateCypher);

    return missionId;
  }

  // ===========================================
  // Redis KV Operations (for TTL, state, locks)
  // ===========================================

  async setKV(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl) {
      await this.redis.setex(key, ttl, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  async getKV<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async delKV(key: string): Promise<void> {
    await this.redis.del(key);
  }

  // ===========================================
  // Helpers
  // ===========================================

  private escapeValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
    if (Array.isArray(value)) {
      const items = value.map(v => this.escapeValue(v));
      return `[${items.join(', ')}]`;
    }
    return `'${JSON.stringify(value).replace(/'/g, "\\'")}'`;
  }

  /**
   * Parse FalkorDB node result
   * Format: [columns, [[[["id", val], ["labels", [...]], ["properties", [[prop, val], ...]]]]], stats]
   */
  private parseNodeResult(result: any[]): Record<string, unknown> {
    if (!result || !result[1] || !result[1][0]) return {};
    
    try {
      // result[1][0] = row data array
      // result[1][0][0] = node structure array [[id,val], [labels,[]], [properties, [[prop,val],...]]]
      const nodeData = result[1][0][0];
      
      const obj: Record<string, unknown> = {};
      
      for (const item of nodeData) {
        if (item[0] === 'properties') {
          // item[1] = [[prop, val], ...]
          for (const prop of item[1]) {
            obj[prop[0]] = this.coerceValue(prop[1]);
          }
        } else if (item[0] === 'id') {
          obj.id = this.coerceValue(item[1]);
        }
        // Skip labels
      }
      
      return obj;
    } catch {
      return {};
    }
  }

  /**
   * Coerce string values back to their proper types
   */
  private coerceValue(value: unknown): unknown {
    if (typeof value === 'string') {
      // Try to parse as number
      if (value === '') return value;
      const num = Number(value);
      if (!isNaN(num) && value.trim() !== '') {
        return num;
      }
      // Boolean strings
      if (value === 'true') return true;
      if (value === 'false') return false;
      // Array/object from JSON string
      if (value.startsWith('[') || value.startsWith('{')) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    }
    return value;
  }

  private parseNodeResults(result: any[]): Record<string, unknown>[] {
    if (!result || !result[1]) return [];
    return result[1].map((row: any) => this.parseNodeResult([null, [row]]));
  }

  raw(): Redis {
    return this.redis;
  }

  async rawQuery(cypher: string): Promise<any[]> {
    return this.graphQuery(cypher);
  }
}

// Factory singleton
let falkordbClient: FalkorDBClient | null = null;

export function getFalkorDB(): FalkorDBClient {
  if (!falkordbClient) {
    const config = getConfig();
    falkordbClient = new FalkorDBClient({
      host: config.FALKORDB_HOST || 'localhost',
      port: parseInt(config.FALKORDB_PORT || '6379'),
      password: config.FALKORDB_PASSWORD,
      graphName: GRAPH_NAME,
    });
  }
  return falkordbClient;
}
