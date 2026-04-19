import Docker from 'dockerode';
import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { ToolCall } from '../types/index.js';

const IS_WINDOWS = os.platform() === 'win32';
const IS_MAC = os.platform() === 'darwin';
const IS_LINUX = os.platform().startsWith('linux');

const IN_DOCKER_CONTAINER = process.env.IN_DOCKER_CONTAINER === 'true' || fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');

function shouldUseSandboxUrlTranslation(): boolean {
  if (IN_DOCKER_CONTAINER) {
    return true;
  }
  if (IS_LINUX) {
    return false;
  }
  if (!isDockerAvailable()) {
    return false;
  }
  return process.env.FORCE_SANDBOX_URL_TRANSLATION === 'true' || true;
}

function isDockerAvailable(): boolean {
  try {
    new Docker({ socketPath: IS_WINDOWS ? '//./pipe/docker_engine' : '/var/run/docker.sock' });
    return true;
  } catch {
    return false;
  }
}

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || 'vibecheck-sandbox:latest';
const SHARED_CONTAINER_NAME = 'vibecheck-sandbox';
const NETWORK_NAME = 'red_team_redteam_net';

const SHARED_DIR_HOST = path.join(os.tmpdir(), 'vibecheck', 'shared');
const SHARED_DIR_CONTAINER = '/tmp/vibecheck/shared';

let DOCKER_NETWORK_MODE: string | null = null;

let _sandboxHealthCache: { available: boolean; lastCheck: number } = {
  available: false,
  lastCheck: 0,
};
const SANDBOX_CHECK_COOLDOWN_MS = 30000; // 30 seconds cooldown before rechecking
let DOCKER_TARGET_HOST: string;
let SANDBOX_TARGET_PORT: string;

if (IS_LINUX) {
  DOCKER_NETWORK_MODE = 'host';
  DOCKER_TARGET_HOST = 'localhost';
  SANDBOX_TARGET_PORT = '3000';
} else {
  DOCKER_NETWORK_MODE = null;
  DOCKER_TARGET_HOST = 'host.docker.internal';
  SANDBOX_TARGET_PORT = '8080';
}

interface ActiveTarget {
  url: string | null;
  host: string | null;
  port: string | null;
}

let _activeTarget: ActiveTarget = {
  url: null,
  host: null,
  port: null,
};

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'info' ? '✅' : '🔍';
  const logLine = `[${timestamp}] ${prefix} [Sandbox] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    console[level](logLine, meta);
  } else {
    console[level](logLine);
  }
}

export function getSandboxTarget(): { host: string; port: string } {
  if (!shouldUseSandboxUrlTranslation()) {
    return { host: 'localhost', port: LOCAL_TARGET_PORT };
  }
  if (IS_LINUX) {
    return { host: 'localhost', port: LOCAL_TARGET_PORT };
  }
  return { host: DOCKER_TARGET_HOST, port: SANDBOX_TARGET_PORT };
}

export function translateUrlForSandbox(url: string): string {
  if (!shouldUseSandboxUrlTranslation()) {
    return url;
  }

  const host = _activeTarget.host || DOCKER_TARGET_HOST;
  const port = _activeTarget.port || SANDBOX_TARGET_PORT;

  const portMatch = url.match(/(localhost|127\.0\.0\.1):(\d+)/);
  if (portMatch) {
    return url.replace(/(localhost|127\.0\.0\.1):\d+/, `${host}:${port}`);
  }

  return url.replace(/(localhost|127\.0\.0\.1)([/:])/, `${host}$2`);
}

export function translateUrlForDirect(url: string): string {
  return url;
}

export function setActiveTarget(url: string | null, host: string | null, port: string | null): void {
  _activeTarget = { url, host, port };
  log('info', `Active target updated: ${url} (${host}:${port})`);
}

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  command: string;
  timed_out: boolean;
  success: boolean;
}

export class SharedSandboxManager {
  private _client: Docker | null = null;
  private _sharedContainer: Docker.Container | null = null;
  private _lock: boolean = false;
  private _dockerUnavailable: boolean = false;
  private _dockerUnavailableUntil: number = 0;
  private _useDirectExecution: boolean = false;
  private static _lastDockerCheck: number = 0;
  private static _dockerAvailable: boolean = false;
  private static readonly DOCKER_COOLDOWN_MS = 30000;

  private getClient(): Docker {
    if (!this._client) {
      try {
        this._client = new Docker({ socketPath: IS_WINDOWS ? '//./pipe/docker_engine' : '/var/run/docker.sock' });
      } catch (err) {
        this._markDockerUnavailable();
        throw err;
      }
    }
    return this._client;
  }

  private _markDockerUnavailable(): void {
    this._dockerUnavailable = true;
    this._dockerUnavailableUntil = Date.now() + 30000;
    log('warn', 'Docker marked unavailable for 30 seconds');
  }

  async ensureImage(): Promise<void> {
    try {
      const client = this.getClient();
      await client.getImage(SANDBOX_IMAGE).inspect();
      log('info', `Sandbox image '${SANDBOX_IMAGE}' exists`);
    } catch {
      log('info', `Building sandbox image '${SANDBOX_IMAGE}'...`);
      try {
        const client = this.getClient();
        await new Promise<void>((resolve, reject) => {
          client.buildImage(
            {
              context: path.join(process.cwd(), 'sandbox'),
              src: ['Dockerfile.sandbox'],
            },
            { t: SANDBOX_IMAGE, rm: true },
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        log('info', 'Sandbox image built successfully');
      } catch (buildErr) {
        log('warn', `Could not build image, will try to pull: ${buildErr}`);
        try {
          const client = this.getClient();
          await new Promise<void>((resolve, reject) => {
            client.pull(SANDBOX_IMAGE, (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } catch (pullErr) {
          log('error', `Failed to pull sandbox image: ${pullErr}`);
          this._markDockerUnavailable();
          throw new Error('Docker unavailable - image pull failed');
        }
      }
    }
  }

  async ensureSharedSandbox(): Promise<Docker.Container> {
    const now = Date.now();
    
    if (this._dockerUnavailable && now < this._dockerUnavailableUntil) {
      throw new Error('Docker unavailable (cooldown)');
    }

    while (this._lock) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this._lock = true;

    try {
      const client = this.getClient();

      try {
        const container = client.getContainer(SHARED_CONTAINER_NAME);
        const info = await container.inspect();
        
        if (info.State?.Running) {
          log('debug', `Shared sandbox '${SHARED_CONTAINER_NAME}' is running`);
          this._sharedContainer = container;
          return container;
        } else {
          log('warn', `Shared sandbox '${SHARED_CONTAINER_NAME}' is ${info.State?.Status || 'unknown'}, starting...`);
          await container.start();
          const updated = await container.inspect();
          if (updated.State?.Running) {
            log('info', `Shared sandbox '${SHARED_CONTAINER_NAME}' started`);
            this._sharedContainer = container;
            return container;
          }
        }
      } catch {
        log('info', `Shared sandbox '${SHARED_CONTAINER_NAME}' not found, creating...`);
      }

      await this.ensureImage();

      const hostDir = path.join(SHARED_DIR_HOST);
      const fs = await import('fs');
      fs.mkdirSync(hostDir, { recursive: true });

      const hostConfig: Docker.HostConfig = {
        Memory: 2 * 1024 * 1024 * 1024,
        Binds: [`${hostDir}:${SHARED_DIR_CONTAINER}`],
        CapAdd: ['NET_RAW', 'NET_ADMIN'],
      };

      if (DOCKER_NETWORK_MODE) {
        hostConfig.NetworkMode = DOCKER_NETWORK_MODE;
      } else {
        try {
          await client.getNetwork(NETWORK_NAME).inspect();
        } catch {
          log('info', `Creating network '${NETWORK_NAME}'`);
          await client.createNetwork({ Name: NETWORK_NAME, Driver: 'bridge' });
        }
        hostConfig.NetworkMode = NETWORK_NAME;
      }

      const container = await client.createContainer({
        name: SHARED_CONTAINER_NAME,
        Image: SANDBOX_IMAGE,
        AttachStdout: false,
        AttachStderr: false,
        Tty: false,
        HostConfig: hostConfig,
        Env: [
          `TARGET_HOST=${DOCKER_TARGET_HOST}`,
          `TARGET_PORT=${SANDBOX_TARGET_PORT}`,
        ],
      });

      await container.start();

      log('info', `Shared sandbox '${SHARED_CONTAINER_NAME}' created (${IS_LINUX ? 'host network' : 'bridge network with host.docker.internal'})`);
      this._sharedContainer = container;
      return container;

    } catch (error) {
      this._markDockerUnavailable();
      throw error;
    } finally {
      this._lock = false;
    }
  }

  async execCommand(
    command: string,
    timeout: number = 60,
    workdir: string = '/tmp'
  ): Promise<ExecResult> {
    if (this._useDirectExecution) {
      return this._execDirect(command, timeout);
    }

    if (this._dockerUnavailable && Date.now() < this._dockerUnavailableUntil) {
      log('warn', 'Docker unavailable, switching to direct execution');
      this._useDirectExecution = true;
      return this._execDirect(command, timeout);
    }

    try {
      const container = await this.ensureSharedSandbox();
      return await this._execInContainer(container, command, timeout, workdir);
    } catch (error) {
      log('warn', `Docker execution failed: ${error}, falling back to direct execution`);
      this._useDirectExecution = true;
      return this._execDirect(command, timeout);
    }
  }

  private _execDirect(command: string, timeout: number): Promise<ExecResult> {
    return new Promise((resolve) => {
      log('debug', `Direct exec: ${command.substring(0, 80)}...`);

      const isWindows = os.platform() === 'win32';
      let shell: string;
      let shellArgs: string[];

      if (isWindows) {
        shell = 'cmd.exe';
        shellArgs = ['/c', command];
      } else {
        shell = '/bin/sh';
        shellArgs = ['-c', command];
      }

      const proc = execFile(shell, shellArgs, {
        timeout: timeout * 1000,
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          if (error.killed || error.code === 'ETIMEDOUT') {
            resolve({
              exit_code: -1,
              stdout: stdout || '',
              stderr: `Command timed out after ${timeout}s`,
              command,
              timed_out: true,
              success: false,
            });
          } else {
            const code = typeof error.code === 'number' ? error.code : -1;
            resolve({
              exit_code: code,
              stdout: stdout || '',
              stderr: stderr || error.message,
              command,
              timed_out: false,
              success: false,
            });
          }
        } else {
          resolve({
            exit_code: 0,
            stdout: stdout || '',
            stderr: stderr || '',
            command,
            timed_out: false,
            success: true,
          });
        }
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    });
  }

  private async _execInContainer(
    container: Docker.Container,
    command: string,
    timeout: number,
    workdir: string
  ): Promise<ExecResult> {
    log('debug', `Sandbox exec: ${command.substring(0, 80)}...`);

    try {
      const exec = await container.exec({
        Cmd: ['sh', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: workdir,
        User: 'root',
        Privileged: true,
      });

      const stream = await exec.start({ hijack: true, stdin: false });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`Command timed out after ${timeout}s`));
        }, timeout * 1000);
      });

      const readStream = new Promise<void>((resolve) => {
        stream.on('data', (chunk: Buffer) => {
          const str = chunk.toString('utf8');
          if (str.startsWith('\x02')) {
            stdout += str.substring(1);
          } else if (str.startsWith('\x03')) {
            stderr += str.substring(1);
          } else {
            stdout += str;
          }
        });
        stream.on('end', () => resolve());
      });

      await Promise.race([readStream, timeoutPromise]);

      const inspectInfo = await exec.inspect();
      const exitCode = inspectInfo.ExitCode || 0;

      const result: ExecResult = {
        exit_code: exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        command,
        timed_out: timedOut,
        success: (exitCode === 0 || exitCode === 18) && !timedOut,
      };

      log('debug', `Sandbox result: exit=${exitCode}`, { timedOut, success: result.success });

      return result;

    } catch (error) {
      const err = error as Error;
      if (err.message.includes('timed out')) {
        return {
          exit_code: -1,
          stdout: '',
          stderr: `Command timed out after ${timeout}s`,
          command,
          timed_out: true,
          success: false,
        };
      }
      log('error', `Sandbox execution failed: ${err.message}`);
      return {
        exit_code: -1,
        stdout: '',
        stderr: `Execution error: ${err.message}`,
        command,
        timed_out: false,
        success: false,
      };
    }
  }

  async executePython(code: string, timeout: number = 60): Promise<ExecResult> {
    const encoded = Buffer.from(code).toString('base64');
    const command = `python3 -c 'import base64; exec(base64.b64decode("${encoded}"))'`;
    return this.execCommand(command, timeout);
  }

  async writeFile(filename: string, content: string, workdir: string = '/workspace'): Promise<ExecResult> {
    const encoded = Buffer.from(content).toString('base64');
    const command = `mkdir -p ${workdir} && echo '${encoded}' | base64 -d > ${workdir}/${filename}`;
    const result = await this.execCommand(command);
    if (result.success) {
      log('info', `Written file to sandbox: ${workdir}/${filename}`);
    } else {
      log('error', `Failed to write file: ${result.stderr}`);
    }
    return result;
  }

  async readFile(filepath: string): Promise<ExecResult> {
    const command = `cat ${filepath} 2>/dev/null || echo 'FILE_NOT_FOUND'`;
    const result = await this.execCommand(command);
    if (result.stdout.trim() === 'FILE_NOT_FOUND') {
      return {
        exit_code: -1,
        stdout: '',
        stderr: `File not found: ${filepath}`,
        command,
        timed_out: false,
        success: false,
      };
    }
    return result;
  }

  async executeScript(scriptPath: string, interpreter: string = 'python3', timeout: number = 60): Promise<ExecResult> {
    const command = `${interpreter} ${scriptPath}`;
    return this.execCommand(command, timeout);
  }

  async configureNetworkIsolation(targetIp?: string, allowedPorts: number[] = [80, 443, 3000, 8080, 11434]): Promise<ExecResult> {
    const commands = [
      'iptables -F OUTPUT',
      'iptables -P OUTPUT DROP',
      'iptables -A OUTPUT -o lo -j ACCEPT',
      'iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT',
    ];

    if (targetIp) {
      for (const port of allowedPorts) {
        commands.push(`iptables -A OUTPUT -p tcp -d ${targetIp} --dport ${port} -j ACCEPT`);
      }
    } else {
      for (const port of allowedPorts) {
        commands.push(`iptables -A OUTPUT -p tcp --dport ${port} -j ACCEPT`);
      }
    }

    commands.push('iptables -A OUTPUT -p udp --dport 53 -j ACCEPT');

    const command = commands.join(' && ');
    const result = await this.execCommand(command);

    if (result.success) {
      log('info', `Network isolation configured for target: ${targetIp || 'any'}`);
    } else {
      log('warn', `Failed to configure network isolation: ${result.stderr}`);
    }

    return result;
  }

  async destroy(): Promise<void> {
    if (this._sharedContainer) {
      try {
        const container = this.getClient().getContainer(SHARED_CONTAINER_NAME);
        await container.stop({ t: 5 });
        await container.remove({ force: true });
        log('info', 'Shared sandbox destroyed');
      } catch (err) {
        log('warn', `Error destroying shared sandbox: ${err}`);
      }
      this._sharedContainer = null;
    }
  }

  async execCurl(args: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
  }): Promise<ExecResult> {
    const { url, method = 'GET', headers = {}, data, timeout = 30 } = args;

    let cmd = `curl -s -w "\\n%{http_code}"`;
    
    for (const [key, value] of Object.entries(headers)) {
      cmd += ` -H '${key}: ${value}'`;
    }
    
    if (method !== 'GET' && data) {
      cmd += ` -X ${method} -d '${data}'`;
    } else if (method !== 'GET') {
      cmd += ` -X ${method}`;
    }
    
    const translateFn = this._useDirectExecution ? translateUrlForDirect : translateUrlForSandbox;
    const translatedUrl = translateFn(url);
    cmd += ` "${translatedUrl}"`;
    
    return this.execCommand(cmd, timeout);
  }

  async execNmap(args: {
    target: string;
    ports?: string;
    flags?: string;
  }): Promise<ExecResult> {
    const { target, ports = '22,80,443,3000,8080', flags = '-sV' } = args;
    const translatedTarget = translateUrlForSandbox(target);
    const command = `nmap ${flags} -p ${ports} ${translatedTarget}`;
    return this.execCommand(command, 120);
  }

  async execNuclei(args: {
    target: string;
    templates?: string[];
    severity?: string[];
  }): Promise<ExecResult> {
    const { target, templates, severity } = args;
    const translatedTarget = translateUrlForSandbox(target);
    
    let cmd = `nuclei -u ${translatedTarget} -json-export -`;
    
    if (templates && templates.length > 0) {
      cmd += ` -t ${templates.join(',')}`;
    }
    
    if (severity && severity.length > 0) {
      cmd += ` -severity ${severity.join(',')}`;
    }
    
    return this.execCommand(cmd, 180);
  }

  async execSqlmap(args: {
    url: string;
    method?: string;
    data?: string;
    level?: number;
    risk?: number;
    flags?: string;
  }): Promise<ExecResult> {
    const { url, method = 'GET', data, level = 1, risk = 1, flags = '' } = args;
    const translatedUrl = translateUrlForSandbox(url);
    
    let cmd = `sqlmap -u "${translatedUrl}" --level=${level} --risk=${risk} --batch --json`;
    
    if (method === 'POST' && data) {
      cmd += ` --data='${data}'`;
    }
    
    if (flags) {
      cmd += ` ${flags}`;
    }
    
    return this.execCommand(cmd, 300);
  }

  async execFfuf(args: {
    url: string;
    wordlist?: string;
    method?: string;
    data?: string;
    filters?: string;
  }): Promise<ExecResult> {
    const { url, wordlist = '/usr/share/wordlists/fuzz.txt', method, data, filters } = args;
    const translatedUrl = translateUrlForSandbox(url);
    
    let cmd = `ffuf -u ${translatedUrl} -w ${wordlist}`;
    
    if (method) {
      cmd += ` -X ${method}`;
    }
    
    if (data) {
      cmd += ` -d '${data}'`;
    }
    
    if (filters) {
      cmd += ` ${filters}`;
    }
    
    cmd += ' -of json -o /tmp/ffuf_results.json';
    const result = await this.execCommand(cmd, 180);
    
    if (result.success) {
      const readResult = await this.readFile('/tmp/ffuf_results.json');
      return { ...result, stdout: readResult.stdout };
    }
    
    return result;
  }

  async execJwtTool(args: {
    action: 'exploit' | 'forge';
    token?: string;
    secret?: string;
    payload?: Record<string, unknown>;
  }): Promise<ExecResult> {
    const { action, token, secret, payload } = args;
    
    let pythonCode = '';
    
    if (action === 'exploit') {
      pythonCode = `
import jwt
token = "${token || ''}"
secrets = ${secret ? `[${secret.split(',').map(s => `"${s}"`).join(',')}]` : '["secret", "password", "jwt_secret", "your-256-bit-secret"]'}
for sec in secrets:
    try:
        decoded = jwt.decode(token, sec, algorithms=["HS256", "HS384", "HS512"])
        print(f"SUCCESS: Secret '{sec}' works! Payload: {decoded}")
        break
    except:
        pass
`;
    } else if (action === 'forge') {
      pythonCode = `
import jwt
import datetime
payload = ${JSON.stringify(payload || {})}
secret = "${secret || 'secret'}"
algorithm = "${secret ? 'HS256' : 'HS384'}"
token = jwt.encode(payload, secret, algorithm=algorithm)
print(token)
`;
    }
    
    return this.executePython(pythonCode, 60);
  }
}

export const sharedSandboxManager = new SharedSandboxManager();

export async function executeToolViaSandbox(
  toolCall: ToolCall,
  timeout: number = 60
): Promise<ExecResult> {
  const { tool, args } = toolCall;

  switch (tool) {
    case 'curl':
      return sharedSandboxManager.execCurl({
        url: args.url as string,
        method: args.method as string || 'GET',
        headers: args.headers as Record<string, string>,
        data: args.data as string,
        timeout: args.timeout as number || 30,
      });

    case 'nmap':
      return sharedSandboxManager.execNmap({
        target: args.target as string || args.url as string,
        ports: args.ports as string,
        flags: args.flags as string,
      });

    case 'nuclei':
      return sharedSandboxManager.execNuclei({
        target: args.target as string || args.url as string,
        templates: args.templates as string[],
        severity: args.severity as string[],
      });

    case 'sqlmap':
    case 'sqlmap_quick':
    case 'sqlmap_deep':
      return sharedSandboxManager.execSqlmap({
        url: args.url as string,
        method: args.method as string,
        data: args.data as string,
        level: tool === 'sqlmap_deep' ? 3 : tool === 'sqlmap_quick' ? 1 : (args.level as number || 1),
        risk: tool === 'sqlmap_deep' ? 2 : (args.risk as number || 1),
        flags: args.flags as string,
      });

    case 'ffuf':
    case 'ffuf_quick':
      return sharedSandboxManager.execFfuf({
        url: args.url as string,
        wordlist: args.wordlist as string,
        method: args.method as string,
        data: args.data as string,
        filters: args.filters as string,
      });

    case 'python':
      return sharedSandboxManager.executePython(args.code as string || args.script as string, timeout);

    case 'jwt_exploit':
      return sharedSandboxManager.execJwtTool({
        action: 'exploit',
        token: args.token as string,
        secret: args.secret as string,
      });

    case 'jwt_forge':
      return sharedSandboxManager.execJwtTool({
        action: 'forge',
        secret: args.secret as string,
        payload: args.payload as Record<string, unknown>,
      });

    default:
      return {
        exit_code: -1,
        stdout: '',
        stderr: `Unknown tool: ${tool}`,
        command: `Unknown tool: ${tool}`,
        timed_out: false,
        success: false,
      };
  }
}

export function isSandboxAvailable(): boolean {
  const now = Date.now();
  
  if (now - _sandboxHealthCache.lastCheck < SANDBOX_CHECK_COOLDOWN_MS) {
    return _sandboxHealthCache.available;
  }
  
  try {
    new Docker({ socketPath: IS_WINDOWS ? '//./pipe/docker_engine' : '/var/run/docker.sock' });
    _sandboxHealthCache = { available: true, lastCheck: now };
    return true;
  } catch {
    _sandboxHealthCache = { available: false, lastCheck: now };
    return false;
  }
}

export async function checkSandboxHealth(): Promise<boolean> {
  const now = Date.now();
  
  if (now - _sandboxHealthCache.lastCheck < SANDBOX_CHECK_COOLDOWN_MS && !_sandboxHealthCache.available) {
    log('debug', `Sandbox health check cached (unavailable), next check in ${Math.ceil((SANDBOX_CHECK_COOLDOWN_MS - (now - _sandboxHealthCache.lastCheck)) / 1000)}s`);
    return false;
  }
  
  try {
    const manager = new SharedSandboxManager();
    await manager.ensureSharedSandbox();
    const result = await manager.execCommand('echo "health_check"');
    _sandboxHealthCache = { available: result.success, lastCheck: now };
    return result.success;
  } catch (error) {
    log('warn', `Sandbox health check failed: ${error}`);
    _sandboxHealthCache = { available: false, lastCheck: now };
    return false;
  }
}
