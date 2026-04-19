import type { MissionState, NodeFunction } from '../core/state-machine.js'
import type { ExploitResult } from '../agents/schemas.js'

const DETERMINISTIC_RULES: Record<string, (result: ExploitResult) => boolean> = {
  sqli: (result: ExploitResult) => {
    if (result.http_status === 500) {
      const body = (result.response_body || '').toLowerCase()
      const dbErrors = ['syntax error', 'mysql', 'pg error', 'ora-', 'sqlite', 'sql syntax']
      return dbErrors.some(e => body.includes(e))
    }
    return result.http_status === 200
  },
  
  xss: (result: ExploitResult) => {
    const body = (result.response_body || '').toLowerCase()
    const payload = (result.injected_payload || result.payload || '').toLowerCase()
    const rawReflected = body.includes(payload)
    const encodedReflected = body.includes(payload.replace(/</g, '%3c').replace(/>/g, '%3e'))
    return rawReflected || encodedReflected
  },
  
  idor: (result: ExploitResult) => {
    return result.http_status === 200 && 
           result.baseline_response !== result.response_body
  },
  
  auth_bypass: (result: ExploitResult) => {
    if (result.http_status === 200 || result.http_status === 201) {
      const body = (result.response_body || '').toLowerCase()
      const privTokens = ['admin', 'role":"admin', 'is_admin":true', 'superuser', 'administrator']
      return privTokens.some(t => body.includes(t))
    }
    return false
  },
  
  ssrf: (result: ExploitResult) => {
    const body = (result.response_body || '').toLowerCase()
    const privateIpPatterns = [
      /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /\b172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}\b/,
      /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
      /\b169\.254\.\d{1,3}\.\d{1,3}\b/,
      /localhost/,
      /internal/,
    ]
    return privateIpPatterns.some(pattern => pattern.test(body))
  },
  
  path_traversal: (result: ExploitResult) => {
    if (result.http_status === 200) {
      const body = (result.response_body || '').toLowerCase()
      const indicators = ['root:', 'etc/passwd', 'c:\\windows', '/etc/shadow', 'boot.ini']
      return indicators.some(i => body.includes(i))
    }
    return false
  },
  
  cmdi: (result: ExploitResult) => {
    return result.http_status >= 500
  },
}

const OWASP_CATEGORY_MAP: Record<string, string> = {
  sqli: 'A03',
  xss: 'A03',
  cmdi: 'A03',
  path_traversal: 'A01',
  idor: 'A01',
  auth_bypass: 'A07',
  ssrf: 'A10',
  missing_auth: 'A01',
  jwt_flaw: 'A07',
}

export const criticEvaluate: NodeFunction = async (state: MissionState): Promise<Partial<MissionState>> => {
  const results: ExploitResult[] = []
  let criticalCount = 0
  let highCount = 0

  for (const exploit of state.exploit_results) {
    const verdict = deterministicEvaluate(exploit)
    
    results.push({
      ...exploit,
      success: verdict.success,
      evidence: verdict.reason,
    })

    if (verdict.success) {
      if (exploit.severity === 'CRITICAL') criticalCount++
      if (exploit.severity === 'HIGH') highCount++
    }
  }

  return {
    exploit_results: results,
    critical_findings_count: (state.critical_findings_count ?? 0) + criticalCount,
    high_findings_count: (state.high_findings_count ?? 0) + highCount,
  }
}

function deterministicEvaluate(result: ExploitResult): { success: boolean; reason: string } {
  const vulnType = result.exploit_type || result.vulnerability_type || ''
  const rule = DETERMINISTIC_RULES[vulnType]
  
  if (!rule) {
    return { success: false, reason: 'Unknown vulnerability type' }
  }
  
  const success = rule(result)
  return {
    success,
    reason: success ? '' : `Deterministic check failed for ${vulnType}`,
  }
}

export function getOWASPCategory(vulnType: string): string | null {
  return OWASP_CATEGORY_MAP[vulnType] ?? null
}
