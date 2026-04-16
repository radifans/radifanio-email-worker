import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../src/db/schema";
import { typesRoute } from "../../../../src/api/routes/types";
import type { Env } from "../../../../src/env";

const db = drizzle(env.EMAIL_DB, { schema });

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/types", typesRoute);
  return app;
}

describe("Types API", () => {
  beforeEach(async () => {
    // Clean up tables between tests
    await env.EMAIL_DB.exec("DELETE FROM attachments");
    await env.EMAIL_DB.exec("DELETE FROM emails");
    await env.EMAIL_DB.exec("DELETE FROM email_types");
  });

  describe("POST /api/types", () => {
    it("creates a new email type", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "creditcard",
            emailPrefix: "creditcard",
            displayName: "Credit Card Statement",
            description: "Monthly credit card statements",
          }),
        },
        env as unknown as Env
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe("creditcard");
      expect(body.data.displayName).toBe("Credit Card Statement");
    });

    it("returns 400 when required fields are missing", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "test" }),
        },
        env as unknown as Env
      );

      expect(res.status).toBe(400);
    });

    it("returns 409 when email prefix already exists", async () => {
      const app = createApp();
      const payload = {
        id: "creditcard",
        emailPrefix: "creditcard",
        displayName: "Credit Card Statement",
      };

      await app.request(
        "/api/types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        env as unknown as Env
      );

      const res = await app.request(
        "/api/types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: "creditcard2" }),
        },
        env as unknown as Env
      );

      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/types", () => {
    it("returns empty array when no types exist", async () => {
      const app = createApp();
      const res = await app.request("/api/types", {}, env as unknown as Env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });

    it("returns all types", async () => {
      await db.insert(schema.emailTypes).values({
        id: "creditcard",
        emailPrefix: "creditcard",
        displayName: "Credit Card",
      });

      const app = createApp();
      const res = await app.request("/api/types", {}, env as unknown as Env);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("creditcard");
    });
  });

  describe("GET /api/types/:id", () => {
    it("returns a single type with email count", async () => {
      await db.insert(schema.emailTypes).values({
        id: "payslip",
        emailPrefix: "payslip",
        displayName: "Payslip",
      });

      const app = createApp();
      const res = await app.request(
        "/api/types/payslip",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe("payslip");
      expect(body.data.emailCount).toBe(0);
    });

    it("returns 404 for non-existent type", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/types/nonexistent",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/types/:id", () => {
    it("updates display name", async () => {
      await db.insert(schema.emailTypes).values({
        id: "creditcard",
        emailPrefix: "creditcard",
        displayName: "Credit Card",
      });

      const app = createApp();
      const res = await app.request(
        "/api/types/creditcard",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: "CC Statement" }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.displayName).toBe("CC Statement");
    });

    it("returns 404 when type does not exist", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/types/nonexistent",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: "Test" }),
        },
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });
});
