import { createHmac, timingSafeEqual } from 'crypto'
import type { AuthorizationContext } from '../agents/schemas.js'
import { getConfig } from './config.js'

export function computeAuthorizationChecksum(auth: AuthorizationContext): string {
  const config = getConfig()
  const secret = config.AUTHORIZATION_HMAC_SECRET ?? 'default-secret-change-me'
  
  const fields = [
    auth.type,
    auth.evidence_url || '',
    auth.scope_domains.sort().join(','),
    auth.excluded_domains.sort().join(','),
    auth.authorized_by,
    auth.authorized_at,
    auth.expiry || '',
  ]
  const canonical = fields.join('|')
  
  return createHmac('sha256', secret)
    .update(canonical)
    .digest('hex')
}

export function verifyChecksum(auth: AuthorizationContext): boolean {
  const expected = computeAuthorizationChecksum(auth)
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(auth.checksum))
  } catch {
    return false
  }
}

export function verifyScope(target: string, scopeDomains: string[]): boolean {
  try {
    let targetHost: string
    if (target.startsWith('http://') || target.startsWith('https://')) {
      targetHost = new URL(target).hostname
    } else {
      targetHost = target.split('/')[0].split(':')[0]
    }
    
    return scopeDomains.some(domain => {
      const scopeHost = domain.toLowerCase().replace(/^\*\./, '')
      return targetHost === scopeHost || targetHost.endsWith('.' + scopeHost)
    })
  } catch {
    return false
  }
}

export function verifyExcluded(target: string, excludedDomains: string[]): boolean {
  try {
    let targetHost: string
    if (target.startsWith('http://') || target.startsWith('https://')) {
      targetHost = new URL(target).hostname
    } else {
      targetHost = target.split('/')[0].split(':')[0]
    }
    
    return excludedDomains.some(domain => {
      const excludedHost = domain.toLowerCase().replace(/^\*\./, '')
      return targetHost === excludedHost || targetHost.endsWith('.' + excludedHost)
    })
  } catch {
    return false
  }
}

export function isExpired(expiry: string | undefined): boolean {
  if (!expiry) return false
  return new Date(expiry) < new Date()
}

export async function verifyVDP(
  evidenceUrl: string, 
  target: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const targetHost = target.startsWith('http') 
      ? new URL(target).hostname 
      : target.split('/')[0].split(':')[0]
    
    const response = await fetch(evidenceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; security-researcher)',
      },
      signal: AbortSignal.timeout(10000),
    })
    
    if (response.status === 403) {
      return { valid: false, error: 'VDP policy page blocked (403)' }
    }
    
    if (response.status !== 200) {
      return { valid: false, error: `VDP policy page returned ${response.status}` }
    }
    
    const text = await response.text()
    const pageText = text.toLowerCase()
    
    if (!pageText.includes(targetHost.toLowerCase())) {
      return { valid: false, error: `Target ${targetHost} not found in VDP scope` }
    }
    
    return { valid: true }
  } catch (error) {
    return { 
      valid: false, 
      error: `VDP verification failed: ${error}` 
    }
  }
}
