import type {
  ExploitResult,
  Evaluation,
  ExecResult,
  DiscoveredToken,
  ExploitType,
} from '../types/index.js';
import { EvaluationSchema } from './schemas.js';
import { llmClient } from '../core/llm-client.js';
import { redisBus } from '../core/redis-bus.js';

const INJECTION_TYPES = ['sqli', 'xss', 'xxe', 'ssti', 'command_injection'];

const ERROR_PATTERNS: Record<string, RegExp[]> = {
  syntax_error: [
    /SyntaxError:/i,
    /Parse error/i,
    /unexpected token/i,
    /JSONDecodeError/i,
    /NameError:/i,
    /TypeError:/i,
  ],
  waf_block: [
    /403 Forbidden/i,
    /WAF/i,
    /ModSecurity/i,
    /blocked/i,
    /detected malicious/i,
  ],
  auth_failure: [
    /401 Unauthorized/i,
    /Invalid credentials/i,
    /login failed/i,
    /Session expired/i,
  ],
  timeout: [
    /timeout/i,
    /timed out/i,
    /Connection timed out/i,
  ],
  not_found: [
    /404 Not Found/i,
    /Endpoint not found/i,
    /Cannot GET/i,
  ],
  rate_limit: [
    /429 Too Many Requests/i,
    /rate limit/i,
  ],
  server_error: [
    /500 Internal Server Error/i,
    /502 Bad Gateway/i,
    /503 Service Unavailable/i,
  ],
};

const SUCCESS_CRITERIA: Record<ExploitType, string[]> = {
  sqli: [
    'Boolean-based true/false in response',
    'UNION works',
    'SQLite/Sequelize errors (query executed)',
    'Authentication bypassed',
    'JWT token returned',
    'User ID returned',
  ],
  xss: [
    'Script tags in response',
    'Payload stored/reflected',
    'HTTP 200/201 with JSON confirmation (stored XSS)',
  ],
  auth_bypass: [
    'Access to admin panel',
    'Elevated privileges',
    'JWT token in response',
  ],
  idor: [
    'Access to other users\' data',
    'Different user IDs in responses',
    'HTTP 200 OK with JSON containing "id"',
  ],
  info_disclosure: [
    'JSON arrays/objects returned',
    'Database fields visible',
  ],
  sensitive_data_exposure: [
    'Password or secret in response',
    'API key exposed',
    'Private data accessed',
  ],
  lfi: [
    'File contents retrieved',
    '/etc/passwd visible',
  ],
  xxe: [
    'File contents retrieved (/etc/passwd)',
    'Error messages showing file system',
  ],
  client_side_bypass: [
    'Client-side validation bypassed',
    'Missing server-side validation',
  ],
  authentication: [
    'Authentication mechanism weak',
    'Default credentials work',
    'Brute force possible',
  ],
  broken_access_control: [
    'Vertical privilege escalation',
    'Horizontal privilege escalation',
    'IDOR confirmed',
  ],
  command_injection: [
    'Command output retrieved',
    'File created/modified via injection',
    'Reverse shell detected',
  ],
  vulnerability_scan: [
    'Vulnerabilities detected',
    'CVE identifiers returned',
    'Risk levels assigned',
  ],
  osint: [
    'Information gathered',
    'Data breach found',
    'Credentials exposed',
  ],
  cve: [
    'CVE identified',
    'Exploit available',
    'Affected version confirmed',
  ],
  jwt: [
    'JWT token forged',
    'Algorithm confusion successful',
    'Token validation bypassed',
    'Secret key exposed',
  ],
  scrape: [
    'Data extracted',
    'Forms enumerated',
    'Endpoints discovered',
  ],
  ffuf: [
    'Endpoints discovered',
    'Virtual hosts found',
    'Parameters fuzzed',
    'Status codes revealed',
  ],
  nmap: [
    'Open ports detected',
    'Services identified',
    'OS detection results',
  ],
  nuclei: [
    'Templates matched',
    'Vulnerabilities scanned',
    'Severity assigned',
  ],
  python: [
    'Script executed',
    'Output retrieved',
    'Module imported',
  ],
  curl: [
    'Response received',
    'Headers captured',
    'Data exfiltrated',
  ],
  ssrf: [
    'SSRF vulnerability detected',
    'Internal resources accessed',
    'Metadata endpoint reached',
  ],
  path_traversal: [
    'Path traversal successful',
    '/etc/passwd retrieved',
    'File contents exposed',
  ],
  prototype_pollution: [
    'Prototype pollution confirmed',
    'Object augmentation possible',
    'Property overwrite successful',
  ],
  open_redirect: [
    'Open redirect detected',
    'Redirect to external domain',
    'Unvalidated redirect',
  ],
  security_misconfiguration: [
    'Security misconfiguration found',
    'Insecure default detected',
    'Missing security headers',
  ],
};

const JUICE_SHOP_PATTERNS = {
  sequelize: [/Sequelize/i, /sequelize/i, /SQLITE/i, /sqlite/i],
  express: [/Express/i, /express/i, /Node\.js/i],
  jwt: [/jwt/i, /JWT/i, /JsonWebToken/i],
  sql_syntax_error: [
    /SQLITE_CANTOPEN/i,
    /SQL syntax/i,
    /near .* syntax error/i,
  ],
  success_indicators: [
    /"id":/,
    /"token":/,
    /"email":/,
    /"role":/,
    /authentication/i,
    /success/i,
    /admin/i,
    /customer/i,
    /200 OK/i,
  ],
};

const DETERMINISTIC_PATTERNS = {
  sqli_success: [
    /SQLITE_ERROR/i,
    /SQLITE_CANTOPEN/i,
    /MySQL error/i,
    /ORA-\d+/i,
    /union select/i,
  ],
  xss_success: [
    /<script/i,
    /alert\s*\(/i,
    /onerror\s*=/i,
    /javascript:/i,
  ],
  auth_success: [
    /"token":\s*"[^"]+"/i,
    /admin/i,
    /dashboard/i,
    /welcome/i,
  ],
  info_disclosure_success: [
    /"password":/i,
    /"secret":/i,
    /api[_-]?key/i,
    /-----BEGIN/i,
  ],
};

function extractStatusCode(combined: string): number | null {
  const match = combined.match(/HTTP\/[\d.]+\s+(\d{3})/i);
  return match ? parseInt(match[1], 10) : null;
}

function extractContentType(combined: string): string {
  const match = combined.match(/Content-Type:\s*([^\s;]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function isApiEndpoint(payload: string): boolean {
  const apiPatterns = [/\/api\//i, /\/rest\//i, /\/graphql/i];
  return apiPatterns.some((pattern) => pattern.test(payload));
}

export function deterministic_precheck(
  result: ExecResult,
  exploitType: string,
  payload: string
): Evaluation | null {
  const combined = result.stdout + result.stderr;
  const statusCode = extractStatusCode(combined) ?? 0;

  if (statusCode === 500 && INJECTION_TYPES.includes(exploitType)) {
    const injectionChars = ["'", '"', '<', '>', ';', '|', '&', '${', '#{', '`'];
    const hasInjection = injectionChars.some((c) => payload.includes(c));

    if (hasInjection) {
      return {
        success: true,
        evidence: `HTTP 500 triggered by ${exploitType} payload - server crash = vulnerable`,
        error_type: 'server_crash',
        severity: 'HIGH',
        deterministic: true,
      };
    }
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      success: false,
      evidence: `HTTP ${statusCode} - Authentication required`,
      error_type: 'auth_required',
      feedback: 'Try using session tokens from previous exploits',
      severity: 'LOW',
      recommendation: 'chain_token',
      deterministic: true,
    };
  }

  if (statusCode === 404) {
    return {
      success: false,
      evidence: 'HTTP 404 - Endpoint not found',
      error_type: 'not_found',
      severity: 'LOW',
      recommendation: 'pivot',
      deterministic: true,
    };
  }

  if (statusCode === 200 && exploitType === 'idor') {
    const contentType = extractContentType(combined);
    if (contentType.includes('application/json') && combined.includes('"id"')) {
      return {
        success: true,
        evidence: "HTTP 200 OK with JSON containing 'id' field - IDOR confirmed",
        error_type: 'none',
        severity: 'HIGH',
        deterministic: true,
      };
    }
  }

  if (statusCode === 200 && payload.includes('/.git/')) {
    const gitIndicators = ['ref:', 'HEAD', '[core]', 'git@github.com'];
    if (gitIndicators.some((ind) => combined.includes(ind))) {
      return {
        success: true,
        evidence: 'CRITICAL: /.git/ exposed - source code reconstruction possible',
        error_type: 'none',
        severity: 'CRITICAL',
        recommendation: 'escalate',
        deterministic: true,
      };
    }
  }

  if (statusCode === 200) {
    const contentType = extractContentType(combined);
    if (contentType === 'text/html' && isApiEndpoint(payload)) {
      return {
        success: false,
        evidence: 'HTTP 200 but returned HTML (SPA catchall)',
        error_type: 'spa_catchall',
        severity: 'LOW',
        recommendation: 'pivot',
        deterministic: true,
      };
    }
  }

  return null;
}

export function scan_for_juice_shop_hints(result: ExecResult): string[] {
  const combined = result.stdout + result.stderr;
  const hints: string[] = [];

  for (const [category, patterns] of Object.entries(JUICE_SHOP_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(combined)) {
        hints.push(category);
        break;
      }
    }
  }

  return [...new Set(hints)];
}

function buildGroundedFeedback(hints: string[], exploitType: string): string {
  if (hints.length === 0) {
    return '';
  }

  const feedbackParts: string[] = [];

  if (hints.includes('sequelize') || hints.includes('sql_syntax_error')) {
    feedbackParts.push('Target appears to use Sequelize/Express - SQL injection likely');
  }

  if (hints.includes('jwt')) {
    feedbackParts.push('JWT authentication detected - token manipulation possible');
  }

  if (hints.includes('express')) {
    feedbackParts.push('Express.js framework detected - standard Node.js vulnerabilities apply');
  }

  return feedbackParts.join('. ');
}

function detectErrorType(combined: string): string {
  for (const [errorType, patterns] of Object.entries(ERROR_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(combined))) {
      return errorType;
    }
  }
  return 'unknown';
}

function checkSuccessPatterns(
  combined: string,
  exploitType: string
): boolean {
  const patterns = DETERMINISTIC_PATTERNS[`${exploitType}_success` as keyof typeof DETERMINISTIC_PATTERNS];
  if (!patterns) return false;
  return patterns.some((pattern) => pattern.test(combined));
}

export async function analyze_exploit_result(
  exploitResult: ExploitResult,
  execResult: ExecResult | null = null,
  previousAttempts: Array<{ payload: string; result: string }> = []
): Promise<Evaluation> {
  const deterministic = deterministic_precheck(
    execResult || {
      exit_code: 0,
      stdout: exploitResult.evidence,
      stderr: '',
      command: '',
      timed_out: false,
      success: true,
    },
    exploitResult.exploit_type,
    exploitResult.payload_used
  );

  if (deterministic) {
    return deterministic;
  }

  const hints = execResult ? scan_for_juice_shop_hints(execResult) : [];
  const groundedFeedback = buildGroundedFeedback(hints, exploitResult.exploit_type);

  if (execResult) {
    const combined = execResult.stdout + execResult.stderr;
    const errorType = detectErrorType(combined);

    if (errorType !== 'unknown') {
      return {
        success: false,
        evidence: `Error type detected: ${errorType}`,
        error_type: errorType,
        feedback: groundedFeedback || undefined,
        severity: 'MEDIUM',
        deterministic: true,
      };
    }

    if (checkSuccessPatterns(combined, exploitResult.exploit_type)) {
      return {
        success: true,
        evidence: `Pattern match confirmed ${exploitResult.exploit_type} vulnerability`,
        error_type: 'none',
        severity: 'HIGH',
        deterministic: true,
      };
    }
  }

  const evaluation = await llmEvaluate(
    exploitResult,
    groundedFeedback,
    previousAttempts
  );

  return evaluation;
}

async function llmEvaluate(
  exploitResult: ExploitResult,
  groundedFeedback: string,
  previousAttempts: Array<{ payload: string; result: string }>
): Promise<Evaluation> {
  const prompt = `You are Critic, evaluating exploit results.

EXPLOIT TYPE: ${exploitResult.exploit_type}
PAYLOAD USED: ${exploitResult.payload_used}
RESULT EVIDENCE: ${exploitResult.evidence.slice(0, 500)}
RESPONSE CODE: ${exploitResult.response_code || 'N/A'}
EXIT CODE: ${exploitResult.execution_time}

${groundedFeedback ? `GROUNDED CONTEXT: ${groundedFeedback}` : ''}

SUCCESS CRITERIA for ${exploitResult.exploit_type}:
${(SUCCESS_CRITERIA[exploitResult.exploit_type as ExploitType] || []).map((c) => `- ${c}`).join('\n')}

${previousAttempts.length > 0 ? `PREVIOUS ATTEMPTS:\n${previousAttempts.map((a) => `- ${a.payload}: ${a.result}`).join('\n')}` : ''}

Respond with a JSON object:
{
  "success": true | false,
  "evidence": "explanation of why this is a success or failure",
  "error_type": "none" | "syntax_error" | "waf_block" | "auth_failure" | "timeout" | "not_found" | "rate_limit" | "server_error",
  "feedback": "constructive feedback for improving the exploit",
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "recommendation": "next action: 'retry' | 'pivot' | 'chain_token' | 'escalate' | 'complete'"
}`;

  const messages = [
    { role: 'system' as const, content: 'You are Critic, an exploit evaluation agent. Always respond with valid JSON.' },
    { role: 'user' as const, content: prompt },
  ];

  try {
    const response = await llmClient.chatForAgent('critic', messages);
    const parsed = JSON.parse(response);
    const evaluation = EvaluationSchema.parse(parsed);

    return {
      ...evaluation,
      recommendation: evaluation.recommendation || 'pivot',
    };
  } catch (error) {
    console.error('Critic LLM evaluation failed:', error);
    return {
      success: exploitResult.success,
      evidence: exploitResult.evidence,
      error_type: 'unknown',
      feedback: 'LLM evaluation failed - using default interpretation',
      severity: 'MEDIUM',
      recommendation: 'pivot',
      deterministic: false,
    };
  }
}

export function extractSessionTokens(result: ExecResult): DiscoveredToken[] {
  const tokens: DiscoveredToken[] = [];
  const combined = result.stdout + result.stderr;

  const jwtRegex = /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  const jwtMatch = combined.match(jwtRegex);

  if (jwtMatch && isValidJWT(jwtMatch[0])) {
    tokens.push({
      name: 'bearer_token',
      value: jwtMatch[0],
      type: 'jwt',
      source: 'response_scan',
      timestamp: new Date().toISOString(),
    });
  }

  const cookieMatch = combined.match(/Set-Cookie:\s*([^;]+)/i);
  if (cookieMatch) {
    tokens.push({
      name: 'cookie',
      value: cookieMatch[1],
      type: 'cookie',
      source: 'response_scan',
      timestamp: new Date().toISOString(),
    });
  }

  return tokens;
}

export function isValidJWT(token: string): boolean {
  const cleanToken = token.replace(/^Bearer\s+/i, '');

  const parts = cleanToken.split('.');
  if (parts.length !== 3) return false;

  for (const part of parts) {
    if (part.length < 4) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(part)) return false;
  }

  return true;
}

export async function storeDiscoveredTokens(
  missionId: string,
  tokens: DiscoveredToken[]
): Promise<void> {
  for (const token of tokens) {
    if (token.name === 'Authorization' && !isValidJWT(token.value)) {
      continue;
    }

    const existing = await redisBus.findings_read(missionId, 'tokens', token.name);
    if (existing && existing.length > token.value.length) {
      continue;
    }

    await redisBus.store_token(missionId, token.name, token.value);
  }
}
