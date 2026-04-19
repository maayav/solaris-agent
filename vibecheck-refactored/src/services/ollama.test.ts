import { describe, it, expect, beforeEach, vi } from "bun:test";

const SKIP_INTEGRATION = !process.env.RUN_INTEGRATION_TESTS;

const mockOllamaInstance = {
  list: vi.fn().mockResolvedValue({ models: [] }),
  chat: vi.fn().mockResolvedValue({
    model: "llama3.1",
    message: { role: "assistant", content: "test response" },
    done_reason: "stop",
    done: true,
  }),
  embed: vi.fn().mockResolvedValue({
    embeddings: [[0.1, 0.2, 0.3]],
  }),
};

vi.mock("./openrouter", () => ({
  openRouterClient: {
    isConfigured: vi.fn().mockReturnValue(false),
    embedCode: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    verifyFinding: vi.fn().mockResolvedValue({
      is_vulnerability: true,
      confidence: "high",
      reasoning: "Test finding",
    }),
  },
}));

import { OllamaClient, type OllamaInterface } from "./ollama";

describe("OllamaClient", () => {
  let client: OllamaClient;

  beforeEach(() => {
    mockOllamaInstance.list.mockResolvedValue({ models: [] });
    mockOllamaInstance.chat.mockResolvedValue({
      model: "llama3.1",
      message: { role: "assistant", content: "test response" },
      done_reason: "stop",
      done: true,
    });
    mockOllamaInstance.embed.mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
    });
    client = new OllamaClient(mockOllamaInstance as unknown as OllamaInterface);
  });

  describe("constructor", () => {
    it("should create instance", () => {
      expect(client).toBeDefined();
    });
  });

  describe("checkHealth", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping Ollama health check test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should return true when Ollama is available and has model", async () => {
      mockOllamaInstance.list.mockResolvedValueOnce({
        models: [{ name: "qwen2.5-coder:7b-instruct" }],
      });

      const result = await client.checkHealth();
      expect(result).toBe(true);
    });

    it("should return false when Ollama is not available", async () => {
      mockOllamaInstance.list.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await client.checkHealth();
      expect(result).toBe(false);
    });

    it("should return false when model is not found", async () => {
      mockOllamaInstance.list.mockResolvedValueOnce({ models: [] });

      const result = await client.checkHealth();
      expect(result).toBe(false);
    });
  });

  describe("chat", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping Ollama chat test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should return chat completion response", async () => {
      const result = await client.chat({
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result).toHaveProperty("model");
      expect(result).toHaveProperty("message");
      expect(result.message.content).toBe("test response");
      expect(result.done).toBe(true);
    });

    it("should use default temperature when not provided", async () => {
      await client.chat({
        messages: [{ role: "user", content: "hello" }],
      });

      expect(mockOllamaInstance.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ temperature: 0.7 }),
        })
      );
    });

    it("should use custom temperature when provided", async () => {
      await client.chat({
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.5,
      });

      expect(mockOllamaInstance.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ temperature: 0.5 }),
        })
      );
    });
  });

  describe("generateEmbedding", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping Ollama embedding test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should return embedding array", async () => {
      mockOllamaInstance.embed.mockResolvedValueOnce({
        embeddings: [[0.1, 0.2, 0.3, 0.4]],
      });

      const result = await client.generateEmbedding("test text");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(4);
    });

    it("should throw error when no embeddings returned", async () => {
      mockOllamaInstance.embed.mockResolvedValueOnce({
        embeddings: [],
      });

      await expect(client.generateEmbedding("test")).rejects.toThrow("No embeddings returned");
    });
  });

  describe("generateEmbeddings", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping Ollama embeddings test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should return array of embedding arrays", async () => {
      mockOllamaInstance.embed.mockResolvedValueOnce({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
      });

      const result = await client.generateEmbeddings(["text1", "text2"]);

      expect(result).toHaveLength(2);
      expect(Array.isArray(result[0])).toBe(true);
    });
  });

  describe("embedCode", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping Ollama embedCode test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should call generateEmbedding", async () => {
      mockOllamaInstance.embed.mockResolvedValueOnce({
        embeddings: [[0.1, 0.2, 0.3]],
      });

      await client.embedCode("const x = 1;");

      expect(mockOllamaInstance.embed).toHaveBeenCalled();
    });
  });

  describe("embedWithOpenRouter", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping OpenRouter embed test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should call openRouterClient.embedCode", async () => {
      const { openRouterClient } = await import("./openrouter");
      await client.embedWithOpenRouter("test code");
      expect(openRouterClient.embedCode).toHaveBeenCalledWith("test code");
    });
  });

  describe("verifyFinding", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping Ollama verifyFinding test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should parse JSON response and return verification result", async () => {
      mockOllamaInstance.chat.mockResolvedValueOnce({
        model: "llama3.1",
        message: {
          role: "assistant",
          content: '{"is_vulnerability": true, "confidence": "high", "reasoning": "SQL injection found", "remediation": "Use parameterized queries"}',
        },
        done_reason: "stop",
        done: true,
      });

      const result = await client.verifyFinding(
        "SELECT * FROM users WHERE id = " + "request.params.id",
        "sql_injection"
      );

      expect(result.is_vulnerability).toBe(true);
      expect(result.confidence).toBe("high");
      expect(result.reasoning).toBe("SQL injection found");
      expect(result.remediation).toBe("Use parameterized queries");
    });

    it("should return low confidence when JSON parsing fails", async () => {
      mockOllamaInstance.chat.mockResolvedValueOnce({
        model: "llama3.1",
        message: { role: "assistant", content: "This is not JSON" },
        done_reason: "stop",
        done: true,
      });

      const result = await client.verifyFinding("code", "sql_injection");

      expect(result.is_vulnerability).toBe(false);
      expect(result.confidence).toBe("low");
      expect(result.reasoning).toBe("Failed to parse LLM response");
    });
  });

  describe("verifyFindingTwoTier", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping Ollama verifyFindingTwoTier test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should use OpenRouter if configured and confidence is high", async () => {
      const { openRouterClient } = await import("./openrouter");
      (openRouterClient.isConfigured as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
      (openRouterClient.verifyFinding as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        is_vulnerability: true,
        confidence: "high",
        reasoning: "OpenRouter found issue",
      });

      const result = await client.verifyFindingTwoTier("code", "sql_injection");

      expect(result.source).toBe("openrouter");
      expect(result.is_vulnerability).toBe(true);
    });

    it("should fall back to Ollama if OpenRouter is not configured", async () => {
      mockOllamaInstance.chat.mockResolvedValueOnce({
        model: "llama3.1",
        message: {
          role: "assistant",
          content: '{"is_vulnerability": false, "confidence": "medium", "reasoning": "No issue found"}',
        },
        done_reason: "stop",
        done: true,
      });

      const result = await client.verifyFindingTwoTier("code", "sql_injection");

      expect(result.source).toBe("ollama");
    });

    it("should fall back to Ollama if OpenRouter confidence is low", async () => {
      const { openRouterClient } = await import("./openrouter");
      (openRouterClient.isConfigured as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
      (openRouterClient.verifyFinding as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        is_vulnerability: true,
        confidence: "low",
        reasoning: "Low confidence",
      });

      mockOllamaInstance.chat.mockResolvedValueOnce({
        model: "llama3.1",
        message: {
          role: "assistant",
          content: '{"is_vulnerability": true, "confidence": "medium", "reasoning": "Ollama found issue"}',
        },
        done_reason: "stop",
        done: true,
      });

      const result = await client.verifyFindingTwoTier("code", "sql_injection");

      expect(result.source).toBe("ollama");
    });
  });

  describe("verifyFindingsBatch", () => {
    if (SKIP_INTEGRATION) {
      it("should skip when RUN_INTEGRATION_TESTS is not set", () => {
        console.log("Skipping Ollama batch test - set RUN_INTEGRATION_TESTS to run");
      });
      return;
    }

    it("should process findings in chunks of concurrency", async () => {
      mockOllamaInstance.chat.mockResolvedValue({
        model: "llama3.1",
        message: {
          role: "assistant",
          content: '{"is_vulnerability": false, "confidence": "low", "reasoning": "OK"}',
        },
        done_reason: "stop",
        done: true,
      });

      const findings = [
        { codeSnippet: "code1", vulnerabilityType: "sql_injection" },
        { codeSnippet: "code2", vulnerabilityType: "sql_injection" },
        { codeSnippet: "code3", vulnerabilityType: "sql_injection" },
      ];

      const results = await client.verifyFindingsBatch(findings, 2);

      expect(results).toHaveLength(3);
    });

    it("should handle errors gracefully in batch", async () => {
      mockOllamaInstance.chat
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValue({
          model: "llama3.1",
          message: {
            role: "assistant",
            content: '{"is_vulnerability": false, "confidence": "low", "reasoning": "OK"}',
          },
          done_reason: "stop",
          done: true,
        });

      const findings = [
        { codeSnippet: "code1", vulnerabilityType: "sql_injection" },
        { codeSnippet: "code2", vulnerabilityType: "sql_injection" },
      ];

      const results = await client.verifyFindingsBatch(findings);

      expect(results).toHaveLength(2);
      expect(results[0]!.confidence).toBe("low");
    });
  });
});
