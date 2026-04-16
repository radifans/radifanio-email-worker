import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { apiKeyAuth } from "../../../../src/api/middleware/auth";
import type { Env } from "../../../../src/env";

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/*", apiKeyAuth());
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("apiKeyAuth middleware", () => {
  it("returns 401 when no API key is provided", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {}, { API_KEY: "secret-key" } as unknown as Env);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Missing API key");
  });

  it("returns 403 when API key is invalid", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/test",
      { headers: { "X-API-Key": "wrong-key" } },
      { API_KEY: "secret-key" } as unknown as Env
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Invalid API key");
  });

  it("passes through when API key is valid", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/test",
      { headers: { "X-API-Key": "secret-key" } },
      { API_KEY: "secret-key" } as unknown as Env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
