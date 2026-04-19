import { env } from "../config/env";

const OPENROUTER_TIMEOUT = 120_000;

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterCompletionOptions {
  model?: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface OpenRouterCompletionResponse {
  id: string;
  model: string;
  choices: {
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenRouterEmbeddingResponse {
  model: string;
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;
  private primaryModel: string;
  private fallbackModel: string;

  constructor() {
    this.apiKey = env.OPENROUTER_API_KEY || "";
    this.baseUrl = env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    this.primaryModel = env.OPENROUTER_PRIMARY_MODEL || "arcee-ai/trinity-large-preview:free";
    this.fallbackModel = env.OPENROUTER_FALLBACK_MODEL || "z-ai/glm-4.5-air:free";
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(options: OpenRouterCompletionOptions): Promise<OpenRouterCompletionResponse> {
    if (!this.apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    const model = options.model || this.primaryModel;
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(env.OPENROUTER_HTTP_REFERER && {
          "HTTP-Referer": env.OPENROUTER_HTTP_REFERER,
        }),
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.max_tokens ?? 1000,
        stream: options.stream ?? false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<OpenRouterCompletionResponse>;
  }

  async *chatStream(options: OpenRouterCompletionOptions): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    const model = options.model || this.primaryModel;
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(env.OPENROUTER_HTTP_REFERER && {
          "HTTP-Referer": env.OPENROUTER_HTTP_REFERER,
        }),
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.max_tokens ?? 1000,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    }
  }

  async embedCode(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(env.OPENROUTER_HTTP_REFERER && {
          "HTTP-Referer": env.OPENROUTER_HTTP_REFERER,
        }),
      },
      body: JSON.stringify({
        model: "sentence-transformers/all-MiniLM-L6-v2",
        input: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter embedding error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterEmbeddingResponse;
    if (!data.data || data.data.length === 0) {
      throw new Error("No embeddings returned from OpenRouter");
    }
    return data.data[0]!.embedding;
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
- nosql_where_injection: MongoDB $where with string concatenation - allows arbitrary JavaScript execution
- orm_operator_injection: JSON.parse(user_input) passed directly to where clause - allows operators like {$gt: 0} to bypass auth
- idor: Insecure Direct Object Reference - UserId from req.body/params used in query without ownership verification
- insecure_cookie: Cookie set without httpOnly flag - vulnerable to XSS theft
- weak_random_secret: Math.random() used for JWT secrets - not cryptographically secure
- prototype_pollution: User input used as object key allowing __proto__ or constructor injection
- path_traversal: User-controlled file paths that could access files outside intended directory
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

    try {
      const response = await this.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || "";
      console.log(`[openrouter] Raw response (${content.length} chars): ${content.slice(0, 300)}...`);
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`[openrouter] Parsed: is_vuln=${parsed.is_vulnerability}, confidence=${parsed.confidence}`);
        return {
          is_vulnerability: parsed.is_vulnerability ?? parsed.is_vulnerability === "true",
          confidence: parsed.confidence || "medium",
          reasoning: parsed.reasoning || parsed.reason || "",
          remediation: parsed.remediation || parsed.fix_suggestion,
        };
      } else {
        console.log(`[openrouter] No JSON found in response`);
      }
    } catch (error) {
      console.error("OpenRouter verification failed:", error);
    }

    return {
      is_vulnerability: false,
      confidence: "low",
      reasoning: "Failed to parse LLM response",
    };
  }
}

export const openRouterClient = new OpenRouterClient();
