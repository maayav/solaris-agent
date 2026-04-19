import type { Finding, CommandResult, LLMMessage } from './types.js';

export class Analyzer {
  private llmRouter: unknown;

  constructor(llmRouter: unknown) {
    this.llmRouter = llmRouter;
  }

  async analyze(
    command: string,
    result: CommandResult,
    context: string
  ): Promise<{ findings: Finding[]; analysis: string; nextAction: string }> {
    const prompt = this.buildAnalysisPrompt(command, result, context);
    const response = await this.callLLM(prompt);
    return this.parseAnalysisResponse(response);
  }

  private buildAnalysisPrompt(command: string, result: CommandResult, context: string): string {
    return `## Task: Analyze command output and extract findings

## Command Executed
\`\`\`bash
${command}
\`\`\`

## Output
\`\`\`
${result.stdout.substring(0, 8000)}
\`\`\`

## Stderr
\`\`\`
${result.stderr.substring(0, 2000)}
\`\`\`

## Exit Code: ${result.exit_code}

## Current Context
${context.substring(0, 3000)}

## Response Format (JSON only, no markdown)
{
  "findings": [
    {
      "type": "jwt|credential|endpoint|vulnerability|info|exploit",
      "value": "brief finding value (max 200 chars)",
      "source": "command or observation"
    }
  ],
  "analysis": "what happened and what it means (2-3 sentences)",
  "nextAction": "next command to run or 'PLAN' to update plan"
}
`;
  }

  private async callLLM(prompt: string): Promise<string> {
    const { llmRouter } = await import('../../agent-swarm/dist/core/llm-router.js');
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are an expert penetration testing analyzer. Output ONLY valid JSON.' },
      { role: 'user', content: prompt },
    ];
    return llmRouter.complete('gamma', messages, { temperature: 0.3 });
  }

  private parseAnalysisResponse(response: string): {
    findings: Finding[];
    analysis: string;
    nextAction: string;
  } {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          findings: (parsed.findings || []).map((f: Partial<Finding>) => ({
            ...f,
            timestamp: Date.now(),
          })),
          analysis: parsed.analysis || 'No significant findings.',
          nextAction: parsed.nextAction || 'PLAN',
        };
      }
    } catch {
      // ignore parse errors
    }
    return {
      findings: [],
      analysis: response.substring(0, 200),
      nextAction: 'PLAN',
    };
  }
}
