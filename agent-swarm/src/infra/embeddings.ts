import { getConfig } from '../config/index.js';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokens: number;
}

const EMBEDDING_MODEL = 'mxbai-embed-large';

export class EmbeddingService {
  private cache = new Map<string, number[]>();
  private baseUrl: string;

  constructor() {
    const baseUrl = getConfig().OLLAMA_BASE_URL || 'http://localhost:11434';
    this.baseUrl = baseUrl;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const cacheKey = text.slice(0, 256);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { embedding: cached, model: EMBEDDING_MODEL, tokens: 0 };
    }

    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding generation failed: ${response.statusText}`);
    }

    const data = await response.json() as { embedding: number[] };
    
    if (!data.embedding || data.embedding.length === 0) {
      throw new Error('Empty embedding returned');
    }

    this.cache.set(cacheKey, data.embedding);
    
    return {
      embedding: data.embedding,
      model: EMBEDDING_MODEL,
      tokens: Math.ceil(text.length / 4),
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    if (a.length === 0) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const embeddingService = new EmbeddingService();