import { Hono } from "hono";
import { ok, errorResponse } from "../../lib/response";
import { redisClient } from "../../db/clients/redis-client";
import { neo4jClient } from "../../db/clients/neo4j-client";
import { qdrantClient } from "../../db/clients/qdrant-client";
import { ollamaClient } from "../../services/ollama";

const healthRoute = new Hono();

interface ServiceHealth {
  status: "healthy" | "not_connected" | "not_responding" | `error: ${string}`;
}

interface HealthStatus {
  status: "healthy" | "degraded";
  services: {
    redis: ServiceHealth["status"];
    neo4j: ServiceHealth["status"];
    qdrant: ServiceHealth["status"];
    ollama: ServiceHealth["status"];
  };
}

healthRoute.get("/", async (c) => {
  const health: HealthStatus = {
    status: "healthy",
    services: {
      redis: "not_connected",
      neo4j: "not_connected",
      qdrant: "not_connected",
      ollama: "not_responding",
    },
  };

  // Check Redis
  try {
    if (redisClient.isConnected) {
      await redisClient.ping();
      health.services.redis = "healthy";
    }
  } catch (e) {
    health.services.redis = `error: ${e instanceof Error ? e.message : String(e)}`;
    health.status = "degraded";
  }

  // Check Neo4j
  try {
    if (neo4jClient.isConnected) {
      await neo4jClient.executeQuery("RETURN 1");
      health.services.neo4j = "healthy";
    }
  } catch (e) {
    health.services.neo4j = `error: ${e instanceof Error ? e.message : String(e)}`;
    health.status = "degraded";
  }

  // Check Qdrant
  try {
    if (qdrantClient.isConnected) {
      await qdrantClient.search("test", { vector: [], limit: 0 });
      health.services.qdrant = "healthy";
    }
  } catch (e) {
    health.services.qdrant = `error: ${e instanceof Error ? e.message : String(e)}`;
    health.status = "degraded";
  }

  // Check Ollama
  try {
    const isHealthy = await ollamaClient.checkHealth();
    health.services.ollama = isHealthy ? "healthy" : "not_responding";
    if (!isHealthy) {
      health.status = "degraded";
    }
  } catch (e) {
    health.services.ollama = `error: ${e instanceof Error ? e.message : String(e)}`;
    health.status = "degraded";
  }

  return ok(c, health);
});

healthRoute.get("/ready", async (c) => {
  const healthResp = await fetch(`${c.req.url.replace("/ready", "")}`, {
    headers: { accept: "application/json" },
  });

  let health: HealthStatus;
  try {
    health = (await healthResp.json()) as HealthStatus;
  } catch {
    return errorResponse(c, 503, "Unable to check service health");
  }

  if (health.status === "healthy") {
    return ok(c, { status: "ready" });
  }
  return errorResponse(c, 503, `Services not ready: ${JSON.stringify(health.services)}`);
});

export { healthRoute };