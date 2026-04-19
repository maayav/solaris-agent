import { env } from "../config/env";
import { Ollama } from "ollama";
import { openRouterClient, type OpenRouterCompletionResponse } from "./openrouter";

export interface OllamaInterface {
  list(): Promise<{ models: Array<{ name: string }> }>;
  chat(options: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    options?: { temperature?: number; num_predict?: number };
    stream?: boolean;
  }): Promise<{
    model: string;
    message: { content: string };
    done_reason: string;
    done: boolean;
  }>;
  embed(options: {
    model: string;
    input: string | string[];
  }): Promise<{ embeddings: number[][] }>;
}

function createOllamaClient(): OllamaInterface {
  const headers: Record<string, string> = {};

  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }

  return new Ollama({
    host: env.OLLAMA_BASE_URL || "http://localhost:11434",
    headers,
  }) as unknown as OllamaInterface;
}

const defaultOllama = createOllamaClient();

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  model: string;
  message: {
    role: "assistant";
    content: string;
  };
  done_reason: string;
  done: boolean;
}

export interface EmbeddingResponse {
  embeddings: number[][];
}

export interface LLMVerificationResult {
  is_vulnerability: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  remediation?: string;
  source: "openrouter" | "ollama";
}

function normalizeConfidence(confidence: unknown): "high" | "medium" | "low" {
  if (confidence === null || confidence === undefined) {
    return "medium";
  }
  if (typeof confidence === "number") {
    if (confidence >= 0.8) return "high";
    if (confidence >= 0.5) return "medium";
    return "low";
  }
  if (typeof confidence === "string") {
    const lower = confidence.toLowerCase();
    if (lower === "high" || lower === "very high") return "high";
    if (lower === "low" || lower === "very low") return "low";
  }
  return "medium";
}

function isLowConfidence(confidence: unknown): boolean {
  if (confidence === null || confidence === undefined) return true;
  if (typeof confidence === "number") return confidence < 0.5;
  if (typeof confidence === "string") {
    return confidence.toLowerCase() === "low" || confidence.toLowerCase() === "very low";
  }
  return false;
}

const FALLBACK_FIXES: Record<string, string> = {
  sql_injection:
    "Use parameterized queries or prepared statements instead of string concatenation.",
  nosql_injection:
    "Sanitize user input before using in MongoDB queries. Avoid using $where with user input.",
  path_traversal:
    "Validate and sanitize file paths using path.normalize() and ensure the resolved path stays within the allowed directory.",
  command_injection:
    "Avoid using exec(), system(), or child_process.exec() with user input.",
  eval_injection: "Never use eval() with user input.",
  ssrf: "Validate and sanitize URLs before fetching. Use an allowlist of permitted domains.",
  open_redirect: "Validate redirect URLs against an allowlist of permitted destinations.",
  hardcoded_secret:
    "Move secrets to environment variables or a secure vault.",
  mass_assignment:
    "Explicitly whitelist allowed fields when updating models.",
  prototype_pollution:
    "Prevent prototype pollution by checking for __proto__, constructor, and prototype keys.",
  security_misconfiguration:
    "Review and harden configuration settings. Disable debug mode in production.",
};

function getFallbackFix(vulnType: string): string {
  return (
    FALLBACK_FIXES[vulnType.toLowerCase()] ||
    "Review the code for security issues. Validate all user inputs."
  );
}

export class OllamaClient {
  private model: string;
  private embedModel: string;
  private ollamaClient: OllamaInterface;

  constructor(ollamaClient?: OllamaInterface) {
    this.model = env.OLLAMA_MODEL || "llama3.1";
    this.embedModel = "nomic-embed-text";
    this.ollamaClient = ollamaClient || defaultOllama;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const models = await this.ollamaClient.list();
      const modelPrefix = this.model.split(":")[0] ?? this.model;
      return models.models.some((m: { name: string }) => m.name.startsWith(modelPrefix));
    } catch {
      return false;
    }
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    const response = await this.ollamaClient.chat({
      model: options.model || this.model,
      messages: options.messages,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.max_tokens ?? 4096,
      },
      stream: false,
    });

    return {
      model: response.model,
      message: {
        role: "assistant",
        content: response.message.content,
      },
      done_reason: response.done_reason,
      done: response.done,
    };
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<string, void, unknown> {
    const response = await (this.ollamaClient.chat({
      model: options.model || this.model,
      messages: options.messages,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.max_tokens ?? 4096,
      },
      stream: true,
    }) as unknown);

    for await (const part of response as AsyncIterable<{ message?: { content?: string } }>) {
      if (part.message?.content) {
        yield part.message.content;
      }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.ollamaClient.embed({
      model: this.embedModel,
      input: text,
    });

    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error("No embeddings returned");
    }
    return response.embeddings[0]!;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await this.ollamaClient.embed({
      model: this.embedModel,
      input: texts,
    });

    return response.embeddings ?? [];
  }

  async embedCode(text: string): Promise<number[]> {
    try {
      return await this.generateEmbedding(text);
    } catch (error) {
      console.warn("[Ollama] Primary embedding failed:", error);
      throw error;
    }
  }

  async embedWithOpenRouter(text: string): Promise<number[]> {
    return openRouterClient.embedCode(text);
  }

  async verifyFinding(
    codeSnippet: string,
    vulnerabilityType: string,
    context?: string
  ): Promise<{
    is_vulnerability: boolean;
    confidence: "high" | "medium" | "low";
    reasoning: string;
    remediation?: string;
  }> {
    const systemPrompt = `You are a security expert. Respond only with valid JSON.`;

    const userPrompt = `You are a security expert analyzing code for the specific vulnerability type: ${vulnerabilityType}.

TASK: Verify if the following code contains a ${vulnerabilityType} vulnerability.

${context ? `Context: ${context}\n` : ""}
Code to analyze:
\`\`\`
${codeSnippet}
\`\`\`

VULNERABILITY TYPE DEFINITIONS:
- sql_injection: User input directly used in SQL queries without parameterization
- nosql_injection: User input used in MongoDB/NoSQL queries in a dangerous way (e.g., $where with string concatenation, JSON.parse in where)
- nosql_where_injection: MongoDB $where with string concatenation - allows arbitrary JavaScript execution (e.g., {{$where: 'this.product == ' + req.body.id}})
- orm_operator_injection: JSON.parse(user_input) passed directly to where clause - allows operators like {{$gt: 0}} to bypass auth
- idor: Insecure Direct Object Reference - UserId from req.body/params used in query without ownership verification (e.g., {{where: {{UserId: req.body.UserId}}}} - note: simplified from actual nested structure)
- insecure_cookie: Cookie set without httpOnly flag - vulnerable to XSS theft
- weak_random_secret: Math.random() used for JWT secrets - not cryptographically secure
- prototype_pollution: User input used as object key allowing __proto__ or constructor injection
- path_traversal: User-controlled file paths that could access files outside intended directory (path.resolve with req.body)
- command_injection: User input passed to shell commands or exec functions
- eval_injection: User input passed to eval() or similar dynamic code execution
- ssrf: User-controlled URLs fetched by the server
- open_redirect: User-controlled redirect URLs without validation
- hardcoded_secret: API keys, passwords, or tokens in source code
- mass_assignment: User input spread directly into model updates without field whitelist
- security_misconfiguration: eval() usage, insecure configurations, debug mode in production

CRITICAL PATTERNS - Set is_vulnerability=true for these:
1. IDOR: req.body.UserId OR req.body.id in where clauses without ownership verification (e.g., findOne({where: {UserId: req.body.UserId}}))
2. NoSQL $where: $where with string concatenation (e.g., {{$where: 'this.product == ' + req.body.id}})
3. JSON.parse in where: JSON.parse(req.params.id) passed directly to where clause
4. Insecure cookies: res.cookie('token', value) without httpOnly: true
5. Weak random for secrets: Math.random() used as JWT secret (e.g., secret: '' + Math.random())
6. Basket/Order IDOR: findOne({where: {id: req.params.id}}) without UserId ownership check

IMPORTANT INSTRUCTIONS:
1. ONLY confirm this finding if it ACTUALLY matches the ${vulnerabilityType} type above
2. If the code shows a DIFFERENT vulnerability type, set is_vulnerability=false
3. If the code is SAFE (e.g., uses parameterized queries, validates input), set is_vulnerability=false
4. When user input (req.body, req.params, req.query) is used in queries WITHOUT explicit ownership verification, CONFIRM the vulnerability
5. Provide a SPECIFIC explanation referencing the exact code pattern found
6. Include a DETAILED fix suggestion with actual code examples

Respond with ONLY this JSON format:
{
  "is_vulnerability": true/false,
  "confidence": "high/medium/low",
  "reasoning": "Detailed explanation of what vulnerability was found or why it's safe",
  "remediation": "Specific code changes needed to fix this vulnerability"
}`;

    const response = await this.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    try {
      const content = response.message.content;
      console.log(`[ollama] Raw response (${content.length} chars): ${content.slice(0, 300)}...`);
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`[ollama] Parsed: is_vuln=${parsed.is_vulnerability}, confidence=${parsed.confidence}`);
        return parsed;
      } else {
        console.log(`[ollama] No JSON found in response`);
      }
    } catch (e) {
      console.log(`[ollama] Parse error: ${e}`);
    }

    return {
      is_vulnerability: false,
      confidence: "low",
      reasoning: "Failed to parse LLM response",
    };
  }

  async verifyFindingTwoTier(
    codeSnippet: string,
    vulnerabilityType: string,
    context?: string
  ): Promise<LLMVerificationResult> {
    let result: LLMVerificationResult | null = null;

    if (openRouterClient.isConfigured()) {
      try {
        const tier1 = await openRouterClient.verifyFinding(
          codeSnippet,
          vulnerabilityType,
          context
        );
        if (tier1 && !isLowConfidence(tier1.confidence)) {
          result = {
            ...tier1,
            source: "openrouter",
          };
        }
      } catch (error) {
        console.warn("OpenRouter verification failed, falling back to Ollama:", error);
      }
    }

    if (!result) {
      const tier2 = await this.verifyFinding(codeSnippet, vulnerabilityType, context);
      result = {
        ...tier2,
        source: "ollama",
      };
    }

    return result;
  }

  async verifyFindingsBatch(
    findings: Array<{
      codeSnippet: string;
      vulnerabilityType: string;
      context?: string;
    }>,
    concurrency: number = 5
  ): Promise<LLMVerificationResult[]> {
    const results: LLMVerificationResult[] = [];

    for (let i = 0; i < findings.length; i += concurrency) {
      const chunk = findings.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((finding) =>
          this.verifyFindingTwoTier(
            finding.codeSnippet,
            finding.vulnerabilityType,
            finding.context
          ).catch((error) => {
            console.error("Batch verification error:", error);
            return {
              is_vulnerability: false,
              confidence: "low" as const,
              reasoning: "Verification failed",
              source: "ollama" as const,
            };
          })
        )
      );
      results.push(...chunkResults);
    }

    return results;
  }
}

export const ollamaClient = new OllamaClient();