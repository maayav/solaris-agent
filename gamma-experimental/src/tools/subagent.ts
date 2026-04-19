import fs from 'fs';
import path from 'path';
import { readTool, ReadToolResult } from './read-tool.js';

export interface SubagentTask {
  description: string;
  prompt: string;
  targetFiles: string[];
  outputFile: string;
  maxTokens?: number;
}

export interface SubagentResult {
  success: boolean;
  output: string;
  filesProcessed: number;
  error?: string;
}

export class SubagentRunner {
  private missionDir: string;
  private llmRouter: any;
  private extractedData: Map<string, any>;

  constructor(missionDir: string, llmRouter: any) {
    this.missionDir = missionDir;
    this.llmRouter = llmRouter;
    this.extractedData = new Map();
  }

  async runExtractionTask(task: SubagentTask): Promise<SubagentResult> {
    const { description, prompt, targetFiles, outputFile } = task;

    let fileContents = '';
    const filesFound: string[] = [];

    for (const filePath of targetFiles) {
      const result = readTool({ filePath, offset: 0, limit: 500 });
      if (!result.output.includes('<error>')) {
        fileContents += `\n\n## File: ${path.basename(filePath)}\n\n${result.output}`;
        filesFound.push(filePath);
      }
    }

    if (filesFound.length === 0) {
      return {
        success: false,
        output: 'No readable files found',
        filesProcessed: 0,
        error: 'Could not read any target files',
      };
    }

    const extractionPrompt = `${prompt}

You are an extraction agent. Read the following file contents and extract ONLY the important information.

FILES TO ANALYZE:
${filesFound.map((f) => path.basename(f)).join(', ')}

${prompt}

---

FILE CONTENTS:
${fileContents}

---

Output your extraction as a JSON object with findings. Structure:
{
  "findings": [...],
  "credentials": [...],
  "vulnerabilities": [...],
  "endpoints": [...],
  "commandResults": [...],
  "summary": "2-3 sentence summary of what you found"
}

Return ONLY the JSON object, no other text.`;

    try {
      const response = await this.llmRouter.complete({
        messages: [{ role: 'user', content: extractionPrompt }],
        maxTokens: task.maxTokens || 2000,
      });

      let output = '';
      if (response.content) {
        output = response.content;
      } else if (response.choices?.[0]?.message?.content) {
        output = response.choices[0].message.content;
      }

      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);
        this.extractedData.set(outputFile, extracted);

        const outputPath = path.join(this.missionDir, outputFile);
        fs.writeFileSync(outputPath, JSON.stringify(extracted, null, 2));

        return {
          success: true,
          output: JSON.stringify(extracted),
          filesProcessed: filesFound.length,
        };
      }

      return {
        success: false,
        output: 'Could not parse JSON from extraction',
        filesProcessed: filesFound.length,
        error: 'JSON parse failed',
      };
    } catch (err: any) {
      return {
        success: false,
        output: '',
        filesProcessed: filesFound.length,
        error: err.message || 'Extraction failed',
      };
    }
  }

  getExtractedData(key: string): any {
    return this.extractedData.get(key);
  }

  hasExtractedData(key: string): boolean {
    return this.extractedData.has(key);
  }
}

export function buildExtractionSubagent(
  missionDir: string,
  llmRouter: any
): SubagentRunner {
  return new SubagentRunner(missionDir, llmRouter);
}
