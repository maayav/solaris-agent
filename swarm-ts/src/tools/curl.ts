import type { Tool, ToolResult } from './registry.js'

export const nmapTool: Tool = {
  name: 'nmap',
  description: 'Network port scanning and service detection',
  
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const target = params.target as string
    const options = params.options as string ?? '-sV -T4'
    
    if (!target) {
      return { success: false, error: 'Missing target parameter' }
    }
    
    try {
      const args = `nmap ${options} ${target}`
      const { spawn } = await import('child_process')
      
      return new Promise((resolve) => {
        const proc = spawn('nmap', options.split(' ').concat([target]), {
          shell: true,
        })
        
        let output = ''
        let error = ''
        
        proc.stdout?.on('data', (data) => { output += data })
        proc.stderr?.on('data', (data) => { error += data })
        proc.on('close', (code) => {
          resolve({
            success: code === 0,
            output: output || error,
            metadata: { target, options, exitCode: code }
          })
        })
        proc.on('error', (err) => {
          resolve({ success: false, error: err.message })
        })
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}

export const nucleiTool: Tool = {
  name: 'nuclei',
  description: 'Vulnerability scanning using nuclei templates',
  
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const target = params.target as string
    const options = params.options as string ?? '-severity critical,high,medium'
    
    if (!target) {
      return { success: false, error: 'Missing target parameter' }
    }
    
    try {
      const { spawn } = await import('child_process')
      
      return new Promise((resolve) => {
        const proc = spawn('nuclei', ['-u', target, ...options.split(' ')], {
          shell: true,
        })
        
        let output = ''
        let error = ''
        
        proc.stdout?.on('data', (data) => { output += data })
        proc.stderr?.on('data', (data) => { error += data })
        proc.on('close', (code) => {
          resolve({
            success: code === 0,
            output: output || error,
            metadata: { target, options, exitCode: code }
          })
        })
        proc.on('error', (err) => {
          resolve({ success: false, error: err.message })
        })
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}

export const curlTool: Tool = {
  name: 'curl',
  description: 'HTTP request crafting and execution',
  
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const target = params.target as string
    const method = (params.method as string) ?? 'GET'
    const headers = params.headers as Record<string, string> ?? {}
    const body = params.body as string
    const followRedirects = params.follow_redirects !== false
    
    if (!target) {
      return { success: false, error: 'Missing target parameter' }
    }
    
    try {
      const url = new URL(target)
      const options: RequestInit = {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VibeCheck-RedTeam)',
          ...headers,
        },
        redirect: followRedirects ? 'follow' : 'manual',
      }
      
      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        options.body = body
      }
      
      const response = await fetch(url.toString(), options)
      const responseBody = await response.text()
      
      return {
        success: true,
        output: responseBody,
        metadata: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        }
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}

export const pythonExecTool: Tool = {
  name: 'python',
  description: 'Execute Python code in sandbox',
  
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const code = params.code as string
    const timeout = (params.timeout as number) ?? 30000
    
    if (!code) {
      return { success: false, error: 'Missing code parameter' }
    }
    
    try {
      const { spawn } = await import('child_process')
      
      return new Promise((resolve) => {
        const proc = spawn('python3', ['-c', code], {
          timeout: timeout / 1000,
        })
        
        let output = ''
        let error = ''
        
        proc.stdout?.on('data', (data) => { output += data })
        proc.stderr?.on('data', (data) => { error += data })
        proc.on('close', (code) => {
          resolve({
            success: code === 0,
            output: output,
            error: error || undefined,
            metadata: { exitCode: code }
          })
        })
        proc.on('error', (err) => {
          resolve({ success: false, error: err.message })
        })
        
        setTimeout(() => {
          proc.kill()
          resolve({ success: false, error: 'Execution timeout' })
        }, timeout)
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}
