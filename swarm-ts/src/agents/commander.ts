import { getLLMClient } from '../core/llm-client.js'
import type { MissionState, NodeFunction } from '../core/state-machine.js'
import type { TaskAssignment, CommanderPlan } from '../agents/schemas.js'

const PLAN_PROMPT = `You are the Commander of a red team operation. Your mission is to decompose the objective into task assignments.

Respond with a JSON object with this structure:
{
  "strategy": "Brief description of the overall strategy",
  "tasks": [
    {
      "description": "Task description",
      "target": "Target URL or path",
      "tools_allowed": ["nmap", "nuclei", "curl"],
      "constraints": []
    }
  ],
  "next_phase": "recon"
}

Objective: {objective}
Target: {target}
Mode: {mode}`

const OBSERVE_PROMPT = `You are the Commander observing the results from field agents. Evaluate the intelligence and decide the next phase.

Respond with a JSON object with this structure:
{
  "next_phase": "recon" | "exploitation" | "complete",
  "strategy_update": "Optional strategy update",
  "reasoning": "Brief reasoning for the decision"
}

Current Phase: {phase}
Iteration: {iteration}
Recon Results: {recon_results}
Exploit Results: {exploit_results}
Coverage Score: {coverage_score}
Stall Count: {stall_count}`

export const commanderPlan: NodeFunction = async (state: MissionState): Promise<Partial<MissionState>> => {
  const llm = getLLMClient()
  
  const messages = [
    { 
      role: 'user' as const, 
      content: PLAN_PROMPT
        .replace('{objective}', state.objective)
        .replace('{target}', state.target)
        .replace('{mode}', state.mode)
    }
  ]

  try {
    const response = await llm.chat('commander', messages)
    const parsed = JSON.parse(response) as CommanderPlan

    return {
      phase: 'recon',
      strategy: parsed.strategy,
      current_tasks: parsed.tasks.map((t, i) => ({
        ...t,
        task_id: `${state.mission_id}-${i}`,
      })),
    }
  } catch (error) {
    console.error('Commander plan failed:', error)
    return {
      phase: 'recon',
      strategy: 'Fallback strategy due to LLM error',
      current_tasks: [{
        description: 'Basic reconnaissance',
        target: state.target,
        tools_allowed: ['nmap', 'curl'],
        constraints: [],
      }],
    }
  }
}

export const commanderObserve: NodeFunction = async (state: MissionState): Promise<Partial<MissionState>> => {
  const llm = getLLMClient()
  
  const messages = [
    { 
      role: 'user' as const, 
      content: OBSERVE_PROMPT
        .replace('{phase}', state.phase)
        .replace('{iteration}', String(state.iteration))
        .replace('{recon_results}', JSON.stringify(state.recon_results.slice(-3)))
        .replace('{exploit_results}', JSON.stringify(state.exploit_results.slice(-3)))
        .replace('{coverage_score}', String(state.coverage_score))
        .replace('{stall_count}', String(state.stall_count))
    }
  ]

  try {
    const response = await llm.chat('commander', messages)
    const parsed = JSON.parse(response)

    return {
      phase: parsed.next_phase,
      iteration: state.iteration + 1,
      strategy: parsed.strategy_update ?? state.strategy,
    }
  } catch (error) {
    console.error('Commander observe failed:', error)
    return {
      phase: 'complete',
      iteration: state.iteration + 1,
    }
  }
}
