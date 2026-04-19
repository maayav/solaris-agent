import { type MiddlewareHandler } from "hono";

const INTERNAL_PATHS = ["/health", "/v0/health"];

export const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  if (INTERNAL_PATHS.includes(c.req.path)) {
    return next();
  }

  const apiKey = c.req.header("x-api-key");

  if (!apiKey) {
    return c.json({ success: false, error: "Missing API key", code: "UNAUTHORIZED" }, 401);
  }

  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return c.json({ success: false, error: "Invalid API key", code: "FORBIDDEN" }, 403);
  }

  return next();
};
