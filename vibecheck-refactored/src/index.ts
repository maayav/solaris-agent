import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./config/env";
import { v0 } from "./routes/v0";
import { requestLogger, errorHandler } from "./middleware/logging";
import { apiKeyAuth } from "./middleware/auth";
import { wsConnectionManager, setWebSocketServer } from "./lib/ws-manager";
import { supabaseClient } from "./db/clients/supabase-client";
import { redisClient } from "./db/clients/redis-client";
import { neo4jClient } from "./db/clients/neo4j-client";
import { qdrantClient } from "./db/clients/qdrant-client";

const app = new Hono();

app.use("*", cors({ origin: env.ALLOWED_ORIGINS, credentials: true }));
app.use("*", requestLogger);
app.use("*", errorHandler);
app.use("*", apiKeyAuth);

app.route("/v0", v0);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  })
);

app.notFound((c) =>
  c.json({ error: "Not Found", path: c.req.path }, 404)
);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500
  );
});

const port = env.PORT;

const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket: {
    open(ws) {
      const wsAny = ws as any;
      const urlStr = wsAny.url as string;
      const url = new URL(urlStr);
      const pathParts = url.pathname.split("/");
      const missionId = pathParts[pathParts.length - 1] ?? "";

      wsConnectionManager.addConnection(ws as any, missionId);

      (async () => {
        try {
          const mission = await supabaseClient.getSwarmMission(missionId);
          if (mission) {
            const findings = await supabaseClient.getSwarmFindings(missionId);
            ws.send(JSON.stringify({
              type: "mission_state",
              data: {
                mission_id: mission.id,
                scan_id: mission.scan_id,
                target: mission.target,
                objective: mission.objective,
                mode: mission.mode,
                status: mission.status,
                progress: mission.progress,
                current_phase: mission.current_phase,
                iteration: mission.iteration,
                max_iterations: mission.max_iterations,
                findings_count: findings.length,
                created_at: mission.created_at,
                started_at: mission.started_at,
                completed_at: mission.completed_at,
              },
            }));
          }
        } catch (err) {
          console.error(`Failed to fetch mission state for ${missionId}:`, err);
        }
      })();
    },
    message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        if (data.action === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // Ignore invalid messages
      }
    },
    close(ws) {
      const wsAny = ws as any;
      const urlStr = wsAny.url as string;
      const url = new URL(urlStr);
      const pathParts = url.pathname.split("/");
      const missionId = pathParts[pathParts.length - 1] ?? "";
      wsConnectionManager.removeConnection(ws as any, missionId);
    },
  },
});

setWebSocketServer(server);

async function connectServices() {
  console.log("Connecting to services...");
  
  try {
    await supabaseClient.connect();
    console.log("✓ Supabase connected");
  } catch (e) {
    console.error("✗ Supabase connection failed:", e);
  }

  try {
    await redisClient.connect();
    console.log("✓ Redis connected");
  } catch (e) {
    console.error("✗ Redis connection failed:", e);
  }

  try {
    await neo4jClient.connect();
    console.log("✓ Neo4j connected");
  } catch (e) {
    console.error("✗ Neo4j connection failed:", e);
  }

  try {
    await qdrantClient.connect();
    console.log("✓ Qdrant connected");
  } catch (e) {
    console.error("✗ Qdrant connection failed:", e);
  }

  console.log("Service connection complete");
}

await connectServices();

console.log(`Starting VibeCheck API server on port ${port}...`);

export default server;
