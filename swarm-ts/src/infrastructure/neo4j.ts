import neo4j from 'neo4j-driver'
import { getConfig } from './config.js'

let neo4jDriver: neo4j.Driver | null = null

export function getNeo4j(): neo4j.Driver {
  if (!neo4jDriver) {
    const config = getConfig()
    if (!config.NEO4J_URI || !config.NEO4J_USERNAME || !config.NEO4J_PASSWORD) {
      throw new Error('Neo4j configuration missing')
    }
    neo4jDriver = neo4j.driver(
      config.NEO4J_URI,
      neo4j.auth.basic(config.NEO4J_USERNAME, config.NEO4J_PASSWORD)
    )
  }
  return neo4jDriver
}

export interface AttackAsset {
  type: string
  identifier: string
  properties?: Record<string, unknown>
}

export interface Vulnerability {
  vulnType: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  cve?: string
  description?: string
}

export class AttackGraphDB {
  private driver: neo4j.Driver

  constructor(driver?: neo4j.Driver) {
    this.driver = driver ?? getNeo4j()
  }

  async createAttackGraph(missionId: string, target: string): Promise<void> {
    const session = this.driver.session()
    try {
      await session.run(
        `CREATE (t:Target {
          mission_id: $missionId,
          url: $url,
          created_at: datetime(),
          status: 'active'
        }) RETURN t`,
        { missionId, url: target }
      )
    } finally {
      await session.close()
    }
  }

  async addAsset(missionId: string, target: string, asset: AttackAsset): Promise<void> {
    const session = this.driver.session()
    try {
      await session.run(
        `MATCH (t:Target {mission_id: $missionId, url: $target})
         CREATE (a:${asset.type} {
           identifier: $identifier,
           discovered_at: datetime(),
           ...props
         })
         CREATE (t)-[:HAS]->(a)
         RETURN a`,
        { 
          missionId, 
          target, 
          identifier: asset.identifier,
          props: asset.properties ?? {}
        }
      )
    } finally {
      await session.close()
    }
  }

  async addVulnerability(
    missionId: string, 
    target: string, 
    vuln: Vulnerability
  ): Promise<void> {
    const session = this.driver.session()
    try {
      await session.run(
        `MATCH (t:Target {mission_id: $missionId, url: $target})
         CREATE (v:Vulnerability {
           type: $type,
           severity: $severity,
           cve: $cve,
           description: $description,
           discovered_at: datetime()
         })
         CREATE (t)-[:HAS_VULN]->(v)
         RETURN v`,
        { 
          missionId, 
          target,
          type: vuln.vulnType, 
          severity: vuln.severity,
          cve: vuln.cve ?? null,
          description: vuln.description ?? null
        }
      )
    } finally {
      await session.close()
    }
  }

  async addCredential(
    missionId: string,
    target: string,
    credType: string,
    handle: string
  ): Promise<void> {
    const session = this.driver.session()
    try {
      await session.run(
        `MATCH (t:Target {mission_id: $missionId, url: $target})
         CREATE (c:Credential {
           type: $type,
           handle: $handle,
           discovered_at: datetime()
         })
         CREATE (t)-[:HAS_CREDENTIAL]->(c)
         RETURN c`,
        { missionId, target, type: credType, handle }
      )
    } finally {
      await session.close()
    }
  }

  async getVulnerabilities(missionId: string): Promise<Vulnerability[]> {
    const session = this.driver.session()
    try {
      const result = await session.run(
        `MATCH (t:Target {mission_id: $missionId})-[:HAS_VULN]->(v:Vulnerability)
         RETURN v.type as type, v.severity as severity, v.cve as cve, v.description as description`,
        { missionId }
      )
      
      return result.records.map(record => ({
        vulnType: record.get('type'),
        severity: record.get('severity'),
        cve: record.get('cve'),
        description: record.get('description'),
      }))
    } finally {
      await session.close()
    }
  }

  async close(): Promise<void> {
    await this.driver.close()
  }
}
