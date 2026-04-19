export interface Tool {
  name: string
  description: string
  execute(params: Record<string, unknown>): Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  list(): string[] {
    return Array.from(this.tools.keys())
  }

  listNames(): string[] {
    return this.list()
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` }
    }
    return await tool.execute(params)
  }
}

export const toolRegistry = new ToolRegistry()
