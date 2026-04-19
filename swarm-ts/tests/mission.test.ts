import { describe, it, expect } from 'vitest'
import { createInitialState } from '../../src/agents/graph.js'
import { commanderPlan } from '../../src/agents/commander.js'

describe('Mission State', () => {
  it('should create initial state with defaults', () => {
    const state = createInitialState({
      objective: 'Test security assessment',
      target: 'http://test.example.com',
    })

    expect(state.mission_id).toBeDefined()
    expect(state.objective).toBe('Test security assessment')
    expect(state.target).toBe('http://test.example.com')
    expect(state.phase).toBe('planning')
    expect(state.max_iterations).toBe(5)
    expect(state.max_cost_usd).toBe(2.0)
    expect(state.max_stall_count).toBe(2)
    expect(state.mode).toBe('live')
  })

  it('should create initial state with custom options', () => {
    const state = createInitialState({
      objective: 'Custom mission',
      target: 'http://custom.example.com',
      max_iterations: 10,
      max_cost_usd: 5.0,
      mode: 'static',
    })

    expect(state.max_iterations).toBe(10)
    expect(state.max_cost_usd).toBe(5.0)
    expect(state.mode).toBe('static')
  })

  it('should create initial state with authorization', () => {
    const state = createInitialState({
      objective: 'Authorized mission',
      target: 'http://authorized.example.com',
      authorization: {
        type: 'vdp',
        scope_domains: ['authorized.example.com'],
        excluded_domains: [],
        authorized_by: 'test@example.com',
        authorized_at: new Date().toISOString(),
        checksum: 'test-checksum',
      },
    })

    expect(state.authorization).toBeDefined()
    expect(state.authorization?.type).toBe('vdp')
  })
})

describe('Schemas', () => {
  it('should validate task assignment schema', () => {
    const { TaskAssignmentSchema } = require('../../src/agents/schemas.js')
    
    const valid = {
      description: 'Scan target',
      target: 'http://test.com',
      tools_allowed: ['nmap'],
    }
    
    expect(() => TaskAssignmentSchema.parse(valid)).not.toThrow()
  })
})
