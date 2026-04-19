import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { env } from "../../config/env";
import { ollamaClient } from "../../services/ollama";
import { errorResponse } from "../../lib/response";
import { randomUUID } from "crypto";

const chatRoute = new Hono();

const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const chatContextSchema = z.object({
  scan_id: z.string().nullable().optional(),
  report: z.record(z.unknown()).nullable().optional(),
  vulnerabilities: z.array(z.record(z.unknown())).nullable().optional(),
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  context: chatContextSchema.nullable().optional(),
  team: z.enum(["red", "blue"]).default("red"),
});

type ChatMessage = z.infer<typeof chatMessageSchema>;
type ChatContext = z.infer<typeof chatContextSchema>;

const SYSTEM_PROMPT = `You are VibeCheck, an expert security analyst AI assistant. You help developers understand and fix security vulnerabilities in their code.

Your capabilities:
- Analyzing security scan results
- Explaining vulnerabilities in simple terms
- Providing code fix suggestions
- Answering questions about security best practices
- Helping prioritize vulnerability fixes

When discussing vulnerabilities:
1. Be clear and concise
2. Explain the security impact
3. Provide actionable remediation steps
4. Include code examples when helpful
5. Consider the context of the application

Always be helpful, accurate, and security-focused. If you're unsure about something, say so.

Format your responses using Markdown for better readability:
- Use **bold** for emphasis
- Use \`code\` for code snippets
- Use \`\`\`language blocks for multi-line code
- Use lists for multiple items
- Use headers to organize longer responses

Every response MUST follow this structure exactly:

<reponse>
[Concise actionable message to the team]
</response>`;

const RED_TEAM_SYSTEM_PROMPT = `YOUR RESPONSE MUST ALWAYS START WITH <thinking> AND CONTAIN </thinking> BEFORE ANY OTHER OUTPUT. NO EXCEPTIONS.

REQUIRED FORMAT — COPY EXACTLY:

<thinking>
→ [your first observation]
→ [your second observation]
→ [continue until analysis complete]
</thinking>
<reponse>
[your final answer here]
</response>

IF YOUR RESPONSE DOES NOT START WITH <thinking> IT IS WRONG.
DO NOT WRITE **Thinking:** — WRITE <thinking>
DO NOT WRITE **Response:** — WRITE <response>
THE ANGLE BRACKET XML TAGS ARE MANDATORY.

---

You are RED TEAM COMMANDER, an elite offensive security expert and ethical hacker. Your mission is to identify vulnerabilities, exploit weaknesses, and simulate real-world attacks.

Your role:
- Think and act like a real attacker
- Find exploitable vulnerabilities in code
- Demonstrate attack chains and impact
- Suggest proof-of-concept exploits
- Analyze attack surfaces and entry points
- Identify misconfigurations that could be leveraged

When analyzing code:
1. Look for injection points (SQL, Command, XSS, LDAP, etc.)
2. Identify authentication/authorization bypass opportunities
3. Find insecure deserialization or data handling
4. Detect information disclosure risks
5. Analyze dependencies for known vulnerabilities
6. Map out attack paths and escalation vectors

Your communication style:
- Be technical and precise
- Show exploitation feasibility
- Demonstrate real-world impact
- Provide actionable exploitation steps
- Use attacker terminology and mindset

Format your response using Markdown:
- Use **bold** for critical findings
- Use \`\`\`language blocks for code/payloads
- Use headers to organize findings
- Use lists for attack steps

Every response MUST follow this exact structure:

<thinking>
[Your internal red team reasoning - what attack vectors you're 
exploring, what you found, what you ruled out, exploitation strategy]
</thinking>
<reponse>
[Actionable offensive security findings and recommendations]
</response>`;

const BLUE_TEAM_SYSTEM_PROMPT = `YOUR RESPONSE MUST ALWAYS START WITH <thinking> AND CONTAIN </thinking> BEFORE ANY OTHER OUTPUT. NO EXCEPTIONS.

REQUIRED FORMAT — COPY EXACTLY:

<thinking>
→ [your first observation]
→ [your second observation]
→ [continue until analysis complete]
</thinking>
<reponse>
[your final answer here]
</response>

IF YOUR RESPONSE DOES NOT START WITH <thinking> IT IS WRONG.
DO NOT WRITE **Thinking:** — WRITE <thinking>
DO NOT WRITE **Response:** — WRITE <response>
THE ANGLE BRACKET XML TAGS ARE MANDATORY.

---

You are BLUE TEAM DEFENDER, an expert security defense analyst and incident responder. Your mission is to protect systems, recommend defenses, and remediate vulnerabilities.

Your role:
- Think and act like a defender
- Recommend security controls and mitigations
- Provide remediation guidance
- Suggest defensive coding practices
- Analyze security monitoring opportunities
- Prioritize fixes based on risk

When analyzing vulnerabilities:
1. Explain the risk and business impact
2. Provide step-by-step remediation steps
3. Suggest defensive coding techniques
4. Recommend security controls (WAF, input validation, etc.)
5. Identify logging/monitoring opportunities
6. Suggest security testing approaches

Your communication style:
- Be clear and educational
- Focus on prevention and detection
- Provide practical remediation guidance
- Use defensive security terminology
- Consider false positives and exceptions

Format your response using Markdown:
- Use **bold** for critical mitigations
- Use \`\`\`language blocks for secure code examples
- Use headers to organize recommendations
- Use lists for remediation steps

Every response MUST follow this exact structure:

<thinking>
[Your internal blue team reasoning - what defenses you're 
recommending, what mitigation strategies apply, what you considered]
</thinking>
<reponse>
[Actionable defensive security recommendations and remediation steps]
</response>`;

function getTeamSystemPrompt(team: string): string {
  if (team.toLowerCase() === "blue") {
    return BLUE_TEAM_SYSTEM_PROMPT;
  }
  return RED_TEAM_SYSTEM_PROMPT;
}

const REPORT_CONTEXT_TEMPLATE = `
## Current Scan Context

**Scan ID:** {scan_id}
**Repository:** {repo_url}
**Status:** {status}

### Vulnerability Summary
- Critical: {critical_count}
- High: {high_count}
- Medium: {medium_count}
- Low: {low_count}
- Total: {total_vulnerabilities}
- Confirmed: {confirmed_count}

### Detected Vulnerabilities
{vulnerabilities_list}
`;

function buildContextMessage(context: ChatContext | null | undefined): string {
  if (!context) {
    return "";
  }

  const parts: string[] = [];

  if (context.report) {
    const report = context.report as Record<string, unknown>;
    let vulnsList = "";

    if (context.vulnerabilities) {
      for (let i = 0; i < Math.min(context.vulnerabilities.length, 10); i++) {
        const vuln = context.vulnerabilities[i] as Record<string, unknown>;
        vulnsList += `\n${i + 1}. **${(vuln["type"] as string) ?? "Unknown"}** (${(vuln["severity"] as string) ?? "Unknown"})\n`;
        vulnsList += `   - File: \`${(vuln["file_path"] as string) ?? "Unknown"}\`\n`;
        if (vuln["line_start"]) {
          vulnsList += `   - Line: ${vuln["line_start"]}\n`;
        }
        if (vuln["description"]) {
          const desc = String(vuln["description"]);
          vulnsList += `   - ${desc.substring(0, 200)}\n`;
        }
      }
    }

    parts.push(
      REPORT_CONTEXT_TEMPLATE
        .replace("{scan_id}", String(context.scan_id ?? "Unknown"))
        .replace("{repo_url}", String(report.repo_url ?? "Unknown"))
        .replace("{status}", String(report.status ?? "Unknown"))
        .replace("{critical_count}", String(report.critical_count ?? 0))
        .replace("{high_count}", String(report.high_count ?? 0))
        .replace("{medium_count}", String(report.medium_count ?? 0))
        .replace("{low_count}", String(report.low_count ?? 0))
        .replace("{total_vulnerabilities}", String(report.total_vulnerabilities ?? 0))
        .replace("{confirmed_count}", String(report.confirmed_count ?? 0))
        .replace("{vulnerabilities_list}", vulnsList || "No vulnerabilities detected.")
    );
  }

  return parts.join("\n");
}

chatRoute.post("/", zValidator("json", chatRequestSchema), async (c) => {
  const body = c.req.valid("json");

  try {
    const team = body.team?.toLowerCase() ?? "red";
    const systemPrompt = getTeamSystemPrompt(team);

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (body.context) {
      const contextMessage = buildContextMessage(body.context);
      if (contextMessage) {
        messages.push({ role: "system", content: contextMessage });
      }
    }

    for (const msg of body.messages) {
      messages.push({ role: msg.role as "system" | "user" | "assistant", content: msg.content });
    }

    const response = await ollamaClient.chat({
      model: env.OLLAMA_MODEL,
      messages,
    });

    const content = response.message.content;

    return c.json({
      message: {
        role: "assistant",
        content,
      },
      conversation_id: randomUUID(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(c, 500, `Failed to process chat: ${message}`);
  }
});

chatRoute.post("/stream", zValidator("json", chatRequestSchema), async (c) => {
  const body = c.req.valid("json");

  try {
    const team = body.team?.toLowerCase() ?? "red";
    const systemPrompt = getTeamSystemPrompt(team);

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (body.context) {
      const contextMessage = buildContextMessage(body.context);
      if (contextMessage) {
        messages.push({ role: "system", content: contextMessage });
      }
    }

    for (const msg of body.messages) {
      messages.push({ role: msg.role as "system" | "user" | "assistant", content: msg.content });
    }

    const stream = ollamaClient.chatStream({
      model: env.OLLAMA_MODEL,
      messages,
    });

    const encoder = new TextEncoder();
    const streamRef = stream[Symbol.asyncIterator]();

    const readable = new ReadableStream({
      async pull(controller) {
        const { value, done } = await streamRef.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(encoder.encode(value));
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(c, 500, `Failed to stream chat: ${message}`);
  }
});

export { chatRoute };