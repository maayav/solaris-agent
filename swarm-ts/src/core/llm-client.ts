import { generateText, ollama } from 'ai'
import { getConfig } from './config.js'

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

const MODEL_TIERS = {
  commander: 'qwen2.5:14b',
  alpha: 'qwen2.5:14b',
  gamma: 'qwen2.5-coder:14b-instruct',
  critic: 'qwen2.5:7b',
  report: 'qwen2.5:14b',
}

export class LLMClient {
  private baseURL: string
  private costs: Map<string, number> = new Map([
    ['qwen2.5:14b', 0.001],
    ['qwen2.5-coder:14b-instruct', 0.001],
    ['qwen2.5:7b', 0.0005],
  ])

  constructor(baseURL?: string) {
    const config = getConfig()
    this.baseURL = baseURL ?? config.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  }

  async chat(
    agentType: keyof typeof MODEL_TIERS,
    messages: Message[],
    options: ChatOptions = {}
  ): Promise<string> {
    const model = MODEL_TIERS[agentType] ?? MODEL_TIERS.commander
    const { temperature = 0.3, maxTokens = 4096 } = options

    try {
      const result = await generateText({
        model: ollama(model, { baseURL: this.baseURL }),
        messages: messages as { role: string; content: string }[],
        temperature,
        maxTokens,
      })

      return result.text
    } catch (error) {
      console.error(`LLM chat failed for ${agentType}:`, error)
      throw error
    }
  }

  getCost(model: string): number {
    return this.costs.get(model) ?? 0.001
  }

  getModelForAgent(agentType: keyof typeof MODEL_TIERS): string {
    return MODEL_TIERS[agentType]
  }
}

let llmClientInstance: LLMClient | null = null

export function getLLMClient(): LLMClient {
  if (!llmClientInstance) {
    llmClientInstance = new LLMClient()
  }
  return llmClientInstance
}
