import { neo4jClient } from "../db/clients/neo4j-client";
import type { CodeEntity, CodeRelationship } from "../types";

const ALLOWED_NODE_TYPES = new Set([
  "function",
  "class",
  "endpoint",
  "import",
  "sql_query",
  "loop",
  "variable",
]);

export interface NPlusOneCandidate {
  endpointPath: string;
  method: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  ormMethod: string;
  model: string;
  functionName: string;
  isDynamic: boolean;
}

export interface GraphStats {
  nodes: number;
  edges: number;
}

export class GraphService {
  async createScanGraph(
    scanId: string,
    projectId: string,
    repositoryUrl: string
  ): Promise<void> {
    const session = neo4jClient.session();

    try {
      await session.run(
        `CREATE (s:Scan {id: $scanId, projectId: $projectId, repositoryUrl: $repositoryUrl, createdAt: datetime()})`,
        { scanId, projectId, repositoryUrl }
      );

      const indexQueries = [
        "CREATE INDEX FOR (f:Function) ON (f.file_path)",
        "CREATE INDEX FOR (l:Loop) ON (f.file_path)",
        "CREATE INDEX FOR (o:ORMCall) ON (f.file_path)",
        "CREATE INDEX FOR (e:Endpoint) ON (f.path)",
        "CREATE INDEX FOR (s:SQLQuery) ON (f.file_path)",
        "CREATE INDEX FOR (m:Module) ON (f.name)",
        "CREATE INDEX FOR (c:CodeEntity) ON (c.id)",
      ];

      for (const query of indexQueries) {
        try {
          await session.run(query);
        } catch {
          // Index may already exist
        }
      }
    } finally {
      await session.close();
    }
  }

  async addNodes(scanId: string, entities: CodeEntity[]): Promise<number> {
    if (entities.length === 0) return 0;

    const nodesByType: Record<string, CodeEntity[]> = {};
    for (const entity of entities) {
      if (!ALLOWED_NODE_TYPES.has(entity.type)) {
        throw new Error(
          `Invalid node type: ${entity.type}. Must be one of: ${[...ALLOWED_NODE_TYPES].join(", ")}`
        );
      }

      const label = entity.type.charAt(0).toUpperCase() + entity.type.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());

      if (!nodesByType[label]) nodesByType[label] = [];
      nodesByType[label].push(entity);
    }

    let totalInserted = 0;
    const session = neo4jClient.session();

    try {
      for (const [label, typedNodes] of Object.entries(nodesByType)) {
        const nodeData = typedNodes.map((n) => ({
          id: n.id,
          type: n.type,
          name: n.name,
          file_path: n.file_path,
          line_start: n.line_start,
          line_end: n.line_end,
          code_snippet: n.code_snippet || "",
          metadata: JSON.stringify(n.metadata || {}),
        }));

        await session.run(
          `MATCH (s:Scan {id: $scanId})
           UNWIND $nodes AS node
           CREATE (e:CodeEntity:${label} {
             id: node.id, type: node.type, name: node.name,
             file_path: node.file_path, line_start: node.line_start,
             line_end: node.line_end, code_snippet: node.code_snippet,
             metadata: node.metadata
           })
           CREATE (s)-[:HAS_ENTITY]->(e)`,
          { scanId, nodes: nodeData }
        );

        totalInserted += typedNodes.length;
      }

      return totalInserted;
    } finally {
      await session.close();
    }
  }

  async createRelationships(
    scanId: string,
    relationships: CodeRelationship[]
  ): Promise<number> {
    if (relationships.length === 0) return 0;

    let edgesCreated = 0;
    const session = neo4jClient.session();

    try {
      for (const rel of relationships) {
        await session.run(
          `MATCH (s:Scan {id: $scanId})
           MATCH (source:CodeEntity {id: $sourceId})
           MATCH (target:CodeEntity {id: $targetId})
           MERGE (source)-[r:RELATES {type: $relationshipType}]->(target)`,
          {
            scanId,
            sourceId: rel.source_id,
            targetId: rel.target_id,
            relationshipType: rel.relationship_type,
          }
        );
        edgesCreated++;
      }

      return edgesCreated;
    } finally {
      await session.close();
    }
  }

  async createContainmentEdges(): Promise<number> {
    let edgesCreated = 0;
    const session = neo4jClient.session();

    try {
      const edgeQueries = [
        {
          query: `
            MATCH (f:Function), (l:Loop)
            WHERE f.file_path = l.file_path
              AND l.line_start >= f.line_start
              AND l.line_end <= f.line_end
            CREATE (f)-[:CONTAINS]->(l)
            RETURN count(*) as count
          `,
          name: "Function->Loop",
        },
        {
          query: `
            MATCH (l:Loop), (o:ORMCall)
            WHERE l.file_path = o.file_path
              AND o.line_start >= l.line_start
              AND o.line_end <= l.line_end
            CREATE (l)-[:CONTAINS]->(o)
            RETURN count(*) as count
          `,
          name: "Loop->ORMCall",
        },
        {
          query: `
            MATCH (l:Loop), (s:SQLQuery)
            WHERE l.file_path = s.file_path
              AND s.line_start >= l.line_start
              AND s.line_end <= l.line_end
            CREATE (l)-[:CONTAINS]->(s)
            RETURN count(*) as count
          `,
          name: "Loop->SQLQuery",
        },
        {
          query: `
            MATCH (e:Endpoint), (f:Function)
            WHERE e.handler = f.name AND e.file_path = f.file_path
            CREATE (e)-[:HAS_ROUTE]->(f)
            RETURN count(*) as count
          `,
          name: "Endpoint->Function (handler)",
        },
        {
          query: `
            MATCH (e:Endpoint), (f:Function)
            WHERE e.file_path = f.file_path
              AND f.line_start >= e.line_start
              AND f.line_end <= e.line_end
              AND NOT (e)-[:HAS_ROUTE]->(f)
            CREATE (e)-[:HAS_ROUTE]->(f)
            RETURN count(*) as count
          `,
          name: "Endpoint->Function (line overlap)",
        },
        {
          query: `
            MATCH (m1:Module), (m2:Module)
            WHERE m1.source = m2.name
            CREATE (m1)-[:IMPORTS]->(m2)
            RETURN count(*) as count
          `,
          name: "Module->Module",
        },
      ];

      for (const { query, name } of edgeQueries) {
        try {
          const result = await session.run(query);
          const count = result.records[0]?.get("count")?.toInt() ?? 0;
          edgesCreated += count;
          console.debug(`Created ${count} ${name} edges`);
        } catch (e) {
          console.warn(`Error creating ${name} edges:`, e);
        }
      }

      return edgesCreated;
    } finally {
      await session.close();
    }
  }

  async detectNPlusOne(scanId: string): Promise<NPlusOneCandidate[]> {
    const session = neo4jClient.session();

    try {
      const result = await session.run(
        `
        MATCH (e:Endpoint)-[:HAS_ROUTE]->(f:Function)-[:CONTAINS]->(l:Loop)-[:CONTAINS]->(q:SQLQuery)
        RETURN e.path as endpointPath,
               e.method as method,
               l.file_path as file,
               l.line_start as lineStart,
               l.line_end as lineEnd,
               q.method as ormMethod,
               q.model as model,
               f.name as functionName,
               l.is_dynamic as isDynamic
        LIMIT 50
      `,
        { scanId }
      );

      return result.records.map((r) => ({
        endpointPath: r.get("endpointPath") || "",
        method: r.get("method") || "",
        file: r.get("file") || "",
        lineStart: r.get("lineStart") || 0,
        lineEnd: r.get("lineEnd") || 0,
        ormMethod: r.get("ormMethod") || "",
        model: r.get("model") || "",
        functionName: r.get("functionName") || "",
        isDynamic: r.get("isDynamic") || false,
      }));
    } finally {
      await session.close();
    }
  }

  async deleteScanGraph(scanId: string): Promise<void> {
    const session = neo4jClient.session();

    try {
      await session.run(
        `MATCH (s:Scan {id: $scanId}) DETACH DELETE s`,
        { scanId }
      );
    } finally {
      await session.close();
    }
  }
}

export const graphService = new GraphService();
