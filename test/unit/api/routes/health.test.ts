import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { healthRoute } from "../../../../src/api/routes/health";
import type { Env } from "../../../../src/env";

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/api/health", healthRoute);

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
  });
});
