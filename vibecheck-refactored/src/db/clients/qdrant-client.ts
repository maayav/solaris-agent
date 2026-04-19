import { QdrantClient as QdrantSDK } from "@qdrant/js-client-rest";
import { env } from "../../config/env";

interface QdrantClientOptions {
  url: string;
  apiKey?: string;
}

export class QdrantClient {
  private client: QdrantSDK | null = null;
  private _isConnected = false;

  constructor(private options: QdrantClientOptions) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    const clientParams: { url: string; apiKey?: string } = {
      url: this.options.url,
    };
    if (this.options.apiKey !== undefined) {
      clientParams.apiKey = this.options.apiKey;
    }
    this.client = new QdrantSDK(clientParams);

    try {
      await this.client.getCollections();
      this._isConnected = true;
    } catch (error) {
      this._isConnected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this._isConnected = false;
  }

  async createCollection(
    name: string,
    config: {
      vectors: {
        size: number;
        distance: "Cosine" | "Euclid" | "Dot";
      };
    }
  ): Promise<boolean> {
    if (!this.client) throw new Error("Client not connected");

    try {
      await this.client.createCollection(name, {
        vectors: {
          size: config.vectors.size,
          distance: config.vectors.distance,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async upsert(
    collectionName: string,
    data: {
      points: Array<{
        id: string | number;
        vector: number[];
        payload?: Record<string, unknown>;
      }>;
    }
  ): Promise<boolean> {
    if (!this.client) throw new Error("Client not connected");

    try {
      await this.client.upsert(collectionName, {
        points: data.points.map((point) => ({
          id: typeof point.id === "string" ? parseInt(point.id, 10) : point.id,
          vector: point.vector,
          payload: point.payload as Record<string, unknown>,
        })),
      });
      return true;
    } catch (error) {
      console.error("Qdrant upsert error:", error);
      return false;
    }
  }

  async search(
    collectionName: string,
    options: {
      vector: number[];
      limit?: number;
      offset?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>> {
    if (!this.client) throw new Error("Client not connected");

    try {
      const results = await this.client.search(collectionName, {
        vector: options.vector,
        limit: options.limit || 10,
        offset: options.offset ?? null,
        filter: options.filter as Record<string, unknown>,
        with_payload: true,
      });

      return results.map((result) => ({
        id: String(result.id),
        score: result.score,
        payload: (result.payload ?? {}) as Record<string, unknown>,
      }));
    } catch (error) {
      console.error("Qdrant search error:", error);
      return [];
    }
  }

  async deleteCollection(name: string): Promise<boolean> {
    if (!this.client) throw new Error("Client not connected");

    try {
      await this.client.deleteCollection(name);
      return true;
    } catch {
      return false;
    }
  }
}

export const qdrantClient = new QdrantClient({
  url: env.QDRANT_URL,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
});