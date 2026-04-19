import type { Phase } from './state.js'
import type { A2AMessage, TaskAssignment, ExploitResult, AuthorizationContext, ReconFinding } from './schemas.js'

export type Phase = 'planning' | 'recon' | 'exploitation' | 'reporting' | 'complete'

export interface MissionState {
  mission_id: string
  objective: string
  target: string
  phase: Phase

  messages: A2AMessage[]
  blackboard: Record<string, unknown>
  recon_results: ReconFinding[]
  exploit_results: ExploitResult[]
  discovered_credentials: string[]

  current_tasks: TaskAssignment[]
  strategy: string

  iteration: number
  max_iterations: number
  needs_human_approval: boolean
  human_response: string | null

  cost_usd: number
  max_cost_usd: number
  started_at: string
  max_duration_seconds: number

  stall_count: number
  max_stall_count: number
  coverage_score: number
  critical_findings_count: number
  high_findings_count: number
  previous_findings_hash: string

  authorization: AuthorizationContext | null
  authorization_verified: boolean

  mode: 'live' | 'static'
  repo_url: string | null

  errors: string[]
}

export type NodeFunction = (state: MissionState) => Promise<Partial<MissionState>>
export type RoutingFunction = (state: MissionState) => string

export interface EdgeDefinition {
  from: string
  to: string | RoutingFunction
}

export class StateMachine {
  private nodes: Map<string, NodeFunction> = new Map()
  private edges: EdgeDefinition[] = []

  addNode(name: string, fn: NodeFunction): this {
    this.nodes.set(name, fn)
    return this
  }

  addEdge(from: string, to: string): this {
    this.edges.push({ from, to })
    return this
  }

  addConditionalEdge(
    from: string,
    routingFn: RoutingFunction,
    _branches: Record<string, string>
  ): this {
    this.edges.push({ from, to: routingFn })
    return this
  }

  async run(initialState: MissionState): Promise<MissionState> {
    let state = initialState
    let currentNode = 'blue_team_enrichment'

    while (true) {
      const node = this.nodes.get(currentNode)
      if (!node) {
        console.error(`Node not found: ${currentNode}`)
        break
      }

      try {
        const updates = await node(state)
        state = { ...state, ...updates }
      } catch (error) {
        console.error(`Error in node ${currentNode}:`, error)
        state.errors = [...state.errors, `Node ${currentNode} failed: ${error}`]
      }

      const edge = this.edges.find(e => e.from === currentNode)
      if (!edge) {
        break
      }

      if (typeof edge.to === 'function') {
        currentNode = edge.to(state)
      } else {
        currentNode = edge.to
      }

      if (currentNode === 'END' || state.phase === 'complete') {
        break
      }
    }

    return state
  }
}

export function shouldContinue(state: MissionState): string {
  const { 
    phase, 
    iteration, 
    max_iterations, 
    stall_count, 
    max_stall_count, 
    cost_usd, 
    max_cost_usd,
    critical_findings_count,
    coverage_score,
  } = state

  if (phase === 'complete') return 'report'
  if (iteration >= max_iterations) return 'report'
  if (stall_count >= max_stall_count) return 'report'
  if (cost_usd >= max_cost_usd) return 'report'

  if (critical_findings_count >= 1 && coverage_score >= 0.3 && iteration >= 2) {
    return 'report'
  }

  if (phase === 'exploitation') return 'exploit_only'

  return 'continue'
}

import { createHash } from 'crypto'

function hashFindings(findings: ExploitResult[]): string {
  const normalized = findings
    .map(f => `${f.exploit_type}|${f.target}`)
    .sort()
    .join('|')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export function computeStallDetection(state: MissionState): MissionState {
  const currentHash = hashFindings(state.exploit_results)
  const prevHash = state.previous_findings_hash

  if (prevHash === '') {
    state.stall_count = 0
  } else if (currentHash === prevHash) {
    state.stall_count = (state.stall_count ?? 0) + 1
  } else {
    state.stall_count = 0
  }

  state.previous_findings_hash = currentHash
  return state
}

export function createInitialState(options: CreateMissionOptions): MissionState {
  return {
    mission_id: options.mission_id ?? crypto.randomUUID(),
    objective: options.objective,
    target: options.target,
    phase: 'planning',
    messages: [],
    blackboard: {},
    recon_results: [],
    exploit_results: [],
    discovered_credentials: [],
    current_tasks: [],
    strategy: '',
    iteration: 0,
    max_iterations: options.max_iterations ?? 5,
    needs_human_approval: false,
    human_response: null,
    cost_usd: 0,
    max_cost_usd: options.max_cost_usd ?? 2.0,
    started_at: new Date().toISOString(),
    max_duration_seconds: options.max_duration_seconds ?? 3600,
    stall_count: 0,
    max_stall_count: options.max_stall_count ?? 2,
    coverage_score: 0,
    critical_findings_count: 0,
    high_findings_count: 0,
    previous_findings_hash: '',
    authorization: options.authorization ?? null,
    authorization_verified: false,
    mode: options.mode ?? detectTargetType(options.target),
    repo_url: options.repo_url ?? null,
    errors: [],
  }
}

function detectTargetType(target: string): 'live' | 'static' {
  if (target.startsWith('http://') || target.startsWith('https://')) return 'live'
  if (target.includes('github.com') || target.includes('gitlab.com')) return 'static'
  try {
    const fs = require('fs')
    if (fs.existsSync(target)) return 'static'
  } catch {}
  return 'live'
}

export interface CreateMissionOptions {
  objective: string
  target: string
  mission_id?: string
  max_iterations?: number
  max_cost_usd?: number
  max_duration_seconds?: number
  max_stall_count?: number
  mode?: 'live' | 'static'
  repo_url?: string
  authorization?: AuthorizationContext
}
