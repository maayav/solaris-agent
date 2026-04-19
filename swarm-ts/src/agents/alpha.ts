import type { MissionState, NodeFunction } from '../core/state-machine.js'
import type { TaskAssignment, ReconFinding } from '../agents/schemas.js'
import { toolRegistry } from '../tools/registry.js'
import { nmapTool, nucleiTool, curlTool } from '../tools/curl.js'
import { getLLMClient } from '../core/llm-client.js'

const STATIC_TOOLS = ['semgrep', 'bandit', 'trufflehog', 'code_search', 'file_tree']
const LIVE_TOOLS = ['nmap', 'nuclei', 'curl', 'ffuf', 'sqlmap', 'jwt_tool']

toolRegistry.register(nmapTool)
toolRegistry.register(nucleiTool)
toolRegistry.register(curlTool)

const ALPHA_DECIDE_PROMPT = `You are Alpha, the reconnaissance agent. Analyze the task and select the best tool.

Task: {task}
Target: {target}
Mode: {mode}
Available Tools: {tools}

Respond with JSON:
{
  "tool": "tool name",
  "reasoning": "why this tool",
  "options": "any command line options"
}`

export const alphaRecon: NodeFunction = async (state: MissionState): Promise<Partial<MissionState>> => {
  const results: ReconFinding[] = []
  const tools = state.mode === 'static' ? STATIC_TOOLS : LIVE_TOOLS

  for (const task of state.current_tasks) {
    const finding = await executeReconTask(task, tools, state.mode)
    results.push(finding)
  }

  return {
    recon_results: results,
    phase: 'exploitation',
  }
}

async function executeReconTask(
  task: TaskAssignment, 
  availableTools: string[],
  mode: 'live' | 'static'
): Promise<ReconFinding> {
  const target = task.target || task.description
  
  if (mode === 'static') {
    return executeStaticRecon(target, task)
  }
  
  const llm = getLLMClient()
  
  try {
    const messages = [
      {
        role: 'user' as const,
        content: ALPHA_DECIDE_PROMPT
          .replace('{task}', task.description)
          .replace('{target}', target)
          .replace('{mode}', mode)
          .replace('{tools}', availableTools.join(', '))
      }
    ]
    
    const response = await llm.chat('alpha', messages)
    const decision = JSON.parse(response)
    
    const toolName = decision.tool || 'curl'
    const tool = toolRegistry.get(toolName)
    
    if (!tool) {
      return {
        tool: toolName,
        target,
        findings: [`Tool not found: ${toolName}`],
        timestamp: new Date().toISOString(),
      }
    }
    
    const result = await tool.execute({
      target,
      ...(decision.options ? { options: decision.options } : {}),
    })
    
    const findings = result.output?.split('\n').filter(l => l.trim()) ?? []
    if (result.error) {
      findings.push(`Error: ${result.error}`)
    }
    
    return {
      tool: toolName,
      target,
      findings,
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    return {
      tool: 'error',
      target,
      findings: [`Recon failed: ${error}`],
      timestamp: new Date().toISOString(),
    }
  }
}

async function executeStaticRecon(
  target: string,
  task: TaskAssignment
): Promise<ReconFinding> {
  return {
    tool: 'static_analysis',
    target,
    findings: ['Static analysis placeholder - implement semgrep/bandit integration'],
    timestamp: new Date().toISOString(),
  }
}
