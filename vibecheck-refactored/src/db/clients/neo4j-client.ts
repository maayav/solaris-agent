import neo4j, { Driver, Session as Neo4jSession, Transaction } from "neo4j-driver";
import { env } from "../../config/env";

interface Neo4jClientOptions {
  uri: string;
  user: string;
  password: string;
}

export class Neo4jClient {
  private driver: Driver | null = null;
  private _isConnected = false;

  constructor(private options: Neo4jClientOptions) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    this.driver = neo4j.driver(
      this.options.uri,
      neo4j.auth.basic(this.options.user, this.options.password),
      {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 10000,
        maxTransactionRetryTime: 30000,
      }
    );

    const session = this.driver.session();
    try {
      await session.run("RETURN 1");
      this._isConnected = true;
    } finally {
      await session.close();
    }
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this._isConnected = false;
    }
  }

  session(): Neo4jSession {
    if (!this.driver) throw new Error("Client not connected");
    return this.driver.session();
  }

  async executeQuery<T = Record<string, unknown>>(
    query: string,
    params?: Record<string, unknown>
  ): Promise<T[]> {
    if (!this.driver) throw new Error("Client not connected");

    const session: Neo4jSession = this.driver.session();
    try {
      const result = await session.run(query, params);
      return result.records.map((record) => {
        const obj: Record<string, unknown> = {};
        record.keys.forEach((key) => {
          obj[key as string] = record.get(key as string);
        });
        return obj as T;
      });
    } finally {
      await session.close();
    }
  }

  async executeWrite(
    query: string,
    params?: Record<string, unknown>
  ): Promise<unknown[]> {
    if (!this.driver) throw new Error("Client not connected");

    const session: Neo4jSession = this.driver.session();
    try {
      const result = await session.run(query, params);
      return result.records.map((record) => record.toObject());
    } finally {
      await session.close();
    }
  }

  async readTransaction<T = Record<string, unknown>>(
    work: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    if (!this.driver) throw new Error("Client not connected");

    const session = this.driver.session();
    try {
      return await session.readTransaction(work);
    } finally {
      await session.close();
    }
  }

  async writeTransaction<T = Record<string, unknown>>(
    work: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    if (!this.driver) throw new Error("Client not connected");

    const session = this.driver.session();
    try {
      return await session.writeTransaction(work);
    } finally {
      await session.close();
    }
  }
}

export const neo4jClient = new Neo4jClient({
  uri: env.NEO4J_URI,
  user: env.NEO4J_USERNAME,
  password: env.NEO4J_PASSWORD,
});