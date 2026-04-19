import { supabaseClient } from './supabase-client.js';
import type { VulnerabilityRecord } from './supabase-client.js';
import type { BlueTeamFinding, ReconResult } from '../types/index.js';

function logWithTimestamp(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [BLUE_TEAM:${level}] ${message}`;
  if (meta) {
    console[level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error'](logLine, meta);
  } else {
    console[level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error'](logLine);
  }
}

async function ensureSupabaseConnected(): Promise<boolean> {
  if (supabaseClient.enabled && supabaseClient.connected) {
    return true;
  }
  
  logWithTimestamp('INFO', 'Supabase not connected, attempting connection...');
  await supabaseClient.connect();
  
  if (supabaseClient.enabled && supabaseClient.connected) {
    logWithTimestamp('INFO', 'Supabase connected successfully');
    return true;
  } else {
    logWithTimestamp('WARN', 'Supabase connection failed or not available');
    return false;
  }
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function extractRepoName(target: string, repoUrl?: string): string | null {
  const githubHttpsMatch = target.match(/github\.com\/[^/]+\/([^/]+)/);
  if (githubHttpsMatch) {
    return githubHttpsMatch[1].replace('.git', '');
  }

  const githubSshMatch = target.match(/github\.com:([^/]+)\/([^/]+)/);
  if (githubSshMatch) {
    return githubSshMatch[2].replace('.git', '');
  }

  const localhostMatch = target.match(/localhost:(\d+)/i);
  if (localhostMatch) {
    const port = localhostMatch[1];
    const portToApp: Record<string, string> = {
      '3000': 'juice-shop',
      '8080': 'juice-shop',
      '8000': 'app',
    };
    const appName = portToApp[port];
    if (appName) return appName;
  }

  if (!target.includes('/') && target.length > 0 && target.length < 100) {
    return target;
  }

  if (repoUrl) {
    const repoGithubHttps = repoUrl.match(/github\.com\/[^/]+\/([^/]+)/);
    if (repoGithubHttps) {
      return repoGithubHttps[1].replace('.git', '');
    }
    const repoGithubSsh = repoUrl.match(/github\.com:([^/]+)\/([^/]+)/);
    if (repoGithubSsh) {
      return repoGithubSsh[2].replace('.git', '');
    }
  }

  return null;
}

function extractEndpoint(filePath: string): string | null {
  if (!filePath) return null;

  const filename = filePath.split('/').pop()?.split('\\').pop();
  if (!filename) return null;

  const nameWithoutExt = filename.replace('.ts', '').replace('.js', '');

  const s1 = nameWithoutExt.replace(/(.)([A-Z][a-z]+)/g, '$1-$2');
  const endpoint = s1.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

  if (endpoint.startsWith('profile')) return `/api/${endpoint}`;
  if (endpoint.startsWith('address')) return `/api/Addresss`;
  if (endpoint.includes('upload')) return `/api/${endpoint}`;
  if (endpoint.startsWith('redirect')) return '/redirect';
  if (endpoint.startsWith('recycles')) return '/api/Recycles';
  if (endpoint.startsWith('quarantine')) return '/api/Products';
  if (endpoint.startsWith('logfile')) return '/api/Logs';
  if (endpoint.startsWith('key')) return '/api/Key';
  if (endpoint.startsWith('data-erasure')) return '/api/Users';
  if (endpoint.startsWith('update-user-profile')) return '/profile';
  if (endpoint.startsWith('update-product-reviews')) return '/api/Products';
  if (endpoint.startsWith('memory')) return '/api/Memory';
  if (endpoint.startsWith('vuln-code-snippet')) return '/api/VulnCode';
  if (endpoint.includes('insecurity')) return '/';

  return `/api/${endpoint}`;
}

function computeExploitSuggestions(finding: BlueTeamFinding): string[] {
  const suggestions: string[] = [];
  const vulnType = finding.vuln_type?.toLowerCase() || '';

  if (vulnType.includes('sql') || vulnType.includes('sqli')) {
    suggestions.push(
      `Test SQL injection at lines ${finding.line_start}-${finding.line_end}`,
      "Try: ' OR '1'='1",
      'Try: UNION SELECT * FROM users',
      'Look for error-based SQLi in error messages'
    );
  } else if (vulnType.includes('xss')) {
    suggestions.push(
      `Test XSS at lines ${finding.line_start}-${finding.line_end}`,
      'Try: <script>alert(1)</script>',
      'Try: "><img src=x onerror=alert(1)>',
      'Check for CSP bypass opportunities'
    );
  } else if (vulnType.includes('path') || vulnType.includes('traversal')) {
    suggestions.push(
      `Test path traversal at lines ${finding.line_start}-${finding.line_end}`,
      'Try: ../../../etc/passwd',
      'Try: ....//....//etc/passwd (bypass filters)'
    );
  } else if (vulnType.includes('command') || vulnType.includes('rce')) {
    suggestions.push(
      `Test command injection at lines ${finding.line_start}-${finding.line_end}`,
      'Try: ; cat /etc/passwd',
      'Try: `whoami`',
      'Try: $(id)'
    );
  } else if (vulnType.includes('secret') || vulnType.includes('hardcoded')) {
    const endpoint = extractEndpoint(finding.file_path || '');
    suggestions.push(
      `Check hardcoded secrets in source code (affects ${endpoint})`,
      'Look for API keys, passwords, tokens in code',
      'Try these credentials against login endpoints'
    );
  } else if (vulnType.includes('auth') || vulnType.includes('jwt')) {
    suggestions.push(
      `Test authentication bypass at lines ${finding.line_start}-${finding.line_end}`,
      'Look for JWT weaknesses (none algorithm, weak signing)',
      'Test for IDOR vulnerabilities'
    );
  } else if (vulnType.includes('deserialize')) {
    suggestions.push(
      `Test deserialization at lines ${finding.line_start}-${finding.line_end}`,
      'Look for pickle, yaml.load, or JSON.parse vulnerabilities',
      'Try prototype pollution payloads'
    );
  } else {
    suggestions.push(
      `Investigate ${vulnType} at lines ${finding.line_start}-${finding.line_end}`,
      'Review code snippet for exploitation opportunities'
    );
  }

  return suggestions;
}

function looksLikeRepo(target: string): boolean {
  if (/github\.com\/[^/]+\/[^/]+/.test(target)) return true;
  if (/git@github\.com:/.test(target)) return true;
  if (!target.includes('/') && target.length > 0 && target.length < 100) return true;
  return false;
}

export function formatBlueTeamBrief(findings: BlueTeamFinding[]): string {
  if (findings.length === 0) {
    return 'No Blue Team static analysis findings available. Proceed with standard reconnaissance.';
  }

  const attackSurface = getPrioritizedAttackSurface(findings);

  const lines: string[] = [
    '═'.repeat(60),
    'BLUE TEAM STATIC ANALYSIS INTELLIGENCE BRIEF',
    '═'.repeat(60),
    `Total Findings: ${findings.length}`,
    '',
    'ATTACK SURFACE ANALYSIS:',
    '',
  ];

  for (const [category, catFindings] of Object.entries(attackSurface)) {
    if (catFindings.length > 0) {
      lines.push(`  ${category.toUpperCase().replace('_', ' ')}:`);
      for (const f of catFindings.slice(0, 5)) {
        lines.push(`    • [${(f.severity || 'low').toUpperCase()}] ${f.title || f.vuln_type}`);
        const endpoint = extractEndpoint(f.file_path || '');
        if (endpoint) {
          lines.push(`      Endpoint: ${endpoint}`);
        }
        if (f.line_start) {
          lines.push(`      Code Location: Line ${f.line_start}`);
        }
        if (f.exploit_suggestions && f.exploit_suggestions.length > 0) {
          lines.push(`      Suggested: ${f.exploit_suggestions[0]}`);
        }
      }
      if (catFindings.length > 5) {
        lines.push(`    ... and ${catFindings.length - 5} more`);
      }
      lines.push('');
    }
  }

  lines.push(
    'EXPLOITATION PRIORITIES:',
    '1. Start with confirmed high/critical findings',
    '2. Use code snippets to craft targeted payloads',
    '3. Test injection points with context-aware payloads',
    '4. Try hardcoded credentials against login endpoints',
    '',
    '═'.repeat(60)
  );

  return lines.join('\n');
}

export function getPrioritizedAttackSurface(
  findings: BlueTeamFinding[]
): Record<string, BlueTeamFinding[]> {
  const attackSurface: Record<string, BlueTeamFinding[]> = {
    injection_points: [],
    authentication: [],
    sensitive_data: [],
    access_control: [],
    configuration: [],
    business_logic: [],
  };

  for (const finding of findings) {
    const vulnType = (finding.vuln_type || '').toLowerCase();

    if (/sql|xss|command|inject/.test(vulnType)) {
      attackSurface.injection_points.push(finding);
    } else if (/auth|jwt|session/.test(vulnType)) {
      attackSurface.authentication.push(finding);
    } else if (/secret|hardcoded|password/.test(vulnType)) {
      attackSurface.sensitive_data.push(finding);
    } else if (/path|traversal|idor/.test(vulnType)) {
      attackSurface.access_control.push(finding);
    } else if (/cors|header|config/.test(vulnType)) {
      attackSurface.configuration.push(finding);
    } else {
      attackSurface.business_logic.push(finding);
    }
  }

  return attackSurface;
}

export async function getBlueTeamFindings(
  target: string,
  options?: {
    minSeverity?: 'critical' | 'high' | 'medium' | 'low';
    includeUnconfirmed?: boolean;
    repoUrl?: string;
  }
): Promise<BlueTeamFinding[]> {
  const startTime = Date.now();
  logWithTimestamp('INFO', `Querying Blue Team findings for target: ${target}`);

  const findings: BlueTeamFinding[] = [];

  const supabaseFindings = await getFromSupabase(
    target,
    options?.minSeverity || 'medium',
    options?.includeUnconfirmed || false,
    options?.repoUrl
  );
  findings.push(...supabaseFindings);

  if (findings.length === 0) {
    const byPattern = await getByRepoPattern(target, options?.minSeverity || 'medium', options?.repoUrl);
    findings.push(...byPattern);
  }

  if (findings.length === 0 && looksLikeRepo(target)) {
    logWithTimestamp('WARN', `No Blue Team findings for ${target}, triggering auto-scan...`);
    await triggerBlueTeamScan(target);
  }

  findings.sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity?.toLowerCase() || 'low'] ?? 4;
    const bOrder = SEVERITY_ORDER[b.severity?.toLowerCase() || 'low'] ?? 4;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (b.confidence_score || 0) - (a.confidence_score || 0);
  });

  for (const finding of findings) {
    finding.exploit_suggestions = computeExploitSuggestions(finding);
  }

  logWithTimestamp('INFO', `Retrieved ${findings.length} Blue Team findings for ${target} in ${Date.now() - startTime}ms`);
  return findings;
}

async function getFromSupabase(
  target: string,
  minSeverity: string,
  _includeUnconfirmed: boolean,
  repoUrl?: string
): Promise<BlueTeamFinding[]> {
  const startTime = Date.now();
  logWithTimestamp('INFO', `Starting Blue Team query for target: ${target}`);
  
  const isConnected = await ensureSupabaseConnected();
  if (!isConnected) {
    logWithTimestamp('WARN', 'Supabase not available for Blue Team query');
    return [];
  }

  try {
    const repoName = extractRepoName(target, repoUrl);
    logWithTimestamp('INFO', `Extracted repo name '${repoName}' from target '${target}'`);

    let scanIds: string[] = [];

    if (repoName) {
      scanIds = await supabaseClient.getScanIdsByRepo(repoName, 500);
      logWithTimestamp('INFO', `Found ${scanIds.length} matching scans for repo: ${repoName}`);
    }

    if (scanIds.length === 0 && /juice|3000|8080/i.test(target)) {
      logWithTimestamp('INFO', `Searching for Juice Shop scans in Supabase for target: ${target}`);
      scanIds = await supabaseClient.getScanIdsByRepo('juice', 100);
      logWithTimestamp('INFO', `Found ${scanIds.length} Juice Shop scans`);
    }

    let vulnerabilities: VulnerabilityRecord[] = [];

    if (scanIds.length > 0) {
      vulnerabilities = await supabaseClient.getVulnerabilities(scanIds, minSeverity);
      logWithTimestamp('INFO', `Found ${vulnerabilities.length} vulnerabilities matching scan_ids`);
    }

    if (vulnerabilities.length === 0 && repoName) {
      vulnerabilities = await supabaseClient.getVulnerabilities([], minSeverity);
      if (vulnerabilities.length > 0) {
        vulnerabilities = vulnerabilities.filter(v =>
          v.file_path?.toLowerCase().includes('juice-shop')
        );
        logWithTimestamp('INFO', `Found ${vulnerabilities.length} vulnerabilities by file_path pattern`);
      }
    }

    if (vulnerabilities.length === 0) {
      logWithTimestamp('INFO', 'No specific matches, fetching recent high-severity vulnerabilities');
      vulnerabilities = await supabaseClient.getRecentHighSeverityVulnerabilities(100);
      logWithTimestamp('INFO', `Found ${vulnerabilities.length} recent high-severity vulnerabilities`);
    }

    if (vulnerabilities.length === 0) {
      logWithTimestamp('WARN', 'No vulnerabilities found in database');
      return [];
    }

    const findingsMap = new Map<string, BlueTeamFinding>();

    for (const row of vulnerabilities) {
      const finding: BlueTeamFinding = {
        finding_id: String(row.id || ''),
        scan_id: String(row.scan_id || ''),
        vuln_type: row.type || 'unknown',
        severity: (row.severity as BlueTeamFinding['severity']) || 'low',
        file_path: row.file_path || '',
        line_start: row.line_start,
        line_end: row.line_end,
        title: row.title,
        description: row.description,
        code_snippet: row.code_snippet,
        confirmed: row.confirmed || false,
        confidence_score: row.confidence_score,
        false_positive: row.false_positive || false,
        fix_suggestion: row.fix_suggestion,
        reproduction_test: row.reproduction_test,
        repo_url: row.repo_url,
        exploit_suggestions: [],
      };

      const endpoint = extractEndpoint(finding.file_path || '');
      const dedupKey = `${endpoint}|${finding.vuln_type}|${finding.line_start}`;

      if (!findingsMap.has(dedupKey)) {
        findingsMap.set(dedupKey, finding);
      }
    }

    const uniqueFindings = Array.from(findingsMap.values());
    logWithTimestamp('INFO', `Deduplicated ${vulnerabilities.length} vulnerabilities to ${uniqueFindings.length} unique findings in ${Date.now() - startTime}ms`);

    return uniqueFindings;
  } catch (error) {
    logWithTimestamp('ERROR', `Failed to query Supabase for Blue Team findings: ${error}`, { elapsed: Date.now() - startTime });
    return [];
  }
}

async function getByRepoPattern(
  target: string,
  minSeverity: string,
  repoUrl?: string
): Promise<BlueTeamFinding[]> {
  const repoName = extractRepoName(target, repoUrl);
  if (!repoName) return [];

  console.debug(`Trying to match by repo name: ${repoName}`);

  return [];
}

async function triggerBlueTeamScan(target: string): Promise<boolean> {
  const blueTeamApi = process.env.BLUE_TEAM_API_URL || 'http://localhost:8000';
  const startTime = Date.now();

  try {
    logWithTimestamp('INFO', `Triggering Blue Team scan for target: ${target}`);
    
    const response = await fetch(`${blueTeamApi}/api/v1/scan/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: target,
        project_name: target.includes('/')
          ? target.split('/').pop()?.replace('.git', '') || target
          : target,
        triggered_by: 'red_team_auto',
        priority: 'high',
      }),
    });

    if (response.ok) {
      const result = await response.json() as { scan_id?: string };
      logWithTimestamp('INFO', `Blue Team scan triggered: ${result.scan_id}`, { elapsed: Date.now() - startTime });
      return true;
    } else {
      logWithTimestamp('ERROR', `Failed to trigger Blue Team scan: HTTP ${response.status}`, { elapsed: Date.now() - startTime });
      return false;
    }
  } catch (error) {
    logWithTimestamp('ERROR', `Error triggering Blue Team scan: ${error}`, { elapsed: Date.now() - startTime });
    return false;
  }
}

export function convertToReconResult(finding: BlueTeamFinding): ReconResult {
  return {
    source: 'blue_team_static_analysis',
    finding_id: finding.finding_id,
    vuln_type: finding.vuln_type,
    severity: finding.severity as ReconResult['severity'],
    file_path: finding.file_path,
    line_start: finding.line_start,
    line_end: finding.line_end,
    title: finding.title || `${finding.vuln_type} in ${finding.file_path}`,
    description: finding.description,
    code_snippet: finding.code_snippet,
    confidence: finding.confidence_score || 0.8,
    confirmed: finding.confirmed,
    exploit_suggestions: finding.exploit_suggestions,
    endpoint: extractEndpoint(finding.file_path || ''),
    asset: extractEndpoint(finding.file_path || '') || finding.file_path || '',
    finding: finding.description || finding.title || finding.vuln_type,
    evidence: finding.code_snippet || '',
    cve_hint: null,
    recommended_action: finding.exploit_suggestions?.[0] ?? null,
  };
}
