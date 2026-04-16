import { createMiddleware } from "hono/factory";
import type { Env } from "../../env";

export function apiKeyAuth() {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const apiKey = c.req.header("X-API-Key");

    if (!apiKey) {
      return c.json({ error: "Missing API key" }, 401);
    }

    if (apiKey !== c.env.API_KEY) {
      return c.json({ error: "Invalid API key" }, 403);
    }

    await next();
  });
}
