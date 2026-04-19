import { type MiddlewareHandler } from "hono";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  const logLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  const timestamp = new Date().toISOString();

  console.log(
    JSON.stringify({
      timestamp,
      level: logLevel,
      method,
      path,
      status,
      duration_ms: duration,
    })
  );
};

export const errorHandler: MiddlewareHandler = async (c, next) => {
  await next();

  if (!c.res.ok && c.res.status === 404) {
    c.res = new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
};
