import { QdrantClient } from '@qdrant/client'
import { getConfig } from './config.js'

let qdrantClient: QdrantClient | null = null

export function getQdrant(): QdrantClient {
  if (!qdrantClient) {
    const config = getConfig()
    if (!config.QDRANT_URL || !config.QDRANT_API_KEY) {
      throw new Error('Qdrant configuration missing')
    }
    qdrantClient = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY,
    })
  }
  return qdrantClient
}

export interface ExploitPayload {
  id: string
  vector: number[]
  payload: Record<string, unknown>
  mission_id: string
  stack: Record<string, string>
  vuln_class: string
  payload_text: string
  tool: string
  endpoint_pattern: string
  cvss: number
}

export class EpisodicMemory {
  private client: QdrantClient

  constructor(client?: QdrantClient) {
    this.client = client ?? getQdrant()
  }

  async storeSuccessfulExploit(exploit: ExploitPayload): Promise<boolean> {
    try {
      await this.client.upsert('successful_exploits', {
        points: [{
          id: exploit.id,
          vector: exploit.vector,
          payload: {
            mission_id: exploit.mission_id,
            stack: exploit.stack,
            vuln_class: exploit.vuln_class,
            payload_text: exploit.payload_text,
            tool: exploit.tool,
            endpoint_pattern: exploit.endpoint_pattern,
            cvss: exploit.cvss,
          },
        }],
      })
      return true
    } catch (error) {
      console.error('Failed to store exploit:', error)
      return false
    }
  }

  async recallStrategies(
    stack: number[],
    vulnClass: string,
    limit = 5
  ): Promise<ExploitPayload[]> {
    try {
      const results = await this.client.search('successful_exploits', {
        vector: stack,
        limit,
        filter: {
          must: [
            { key: 'vuln_class', match: { value: vulnClass } }
          ]
        }
      })
      
      return results.map(r => ({
        id: r.id,
        vector: r.vector,
        payload: r.payload as Record<string, unknown>,
        mission_id: r.payload.mission_id,
        stack: r.payload.stack,
        vuln_class: r.payload.vuln_class,
        payload_text: r.payload.payload_text,
        tool: r.payload.tool,
        endpoint_pattern: r.payload.endpoint_pattern,
        cvss: r.payload.cvss,
      }))
    } catch (error) {
      console.error('Failed to recall strategies:', error)
      return []
    }
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name)
  }

  async createCollection(name: string, vectorSize: number): Promise<void> {
    await this.client.createCollection(name, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
    })
  }
}
