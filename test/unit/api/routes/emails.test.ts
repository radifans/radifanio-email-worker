import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../src/db/schema";
import { emailsRoute } from "../../../../src/api/routes/emails";
import type { Env } from "../../../../src/env";

const db = drizzle(env.EMAIL_DB, { schema });

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/emails", emailsRoute);
  return app;
}

async function seedData() {
  await db.insert(schema.emailTypes).values({
    id: "creditcard",
    emailPrefix: "creditcard",
    displayName: "Credit Card",
  });

  await db.insert(schema.emails).values({
    id: "01ABC123",
    typeId: "creditcard",
    fromAddress: "bank@example.com",
    toAddress: "creditcard@auto.example.com",
    subject: "March Statement",
    receivedAt: "2026-03-15T10:30:00Z",
    storagePrefix: "creditcard/2026/03/15/01ABC123",
    rawSize: 1024,
    status: "received",
  });

  await db.insert(schema.attachments).values({
    id: "01ATT456",
    emailId: "01ABC123",
    filename: "statement.pdf",
    contentType: "application/pdf",
    size: 512,
    storageKey: "creditcard/2026/03/15/01ABC123/attachments/statement.pdf",
  });
}

describe("Emails API", () => {
  beforeEach(async () => {
    await env.EMAIL_DB.exec("DELETE FROM attachments");
    await env.EMAIL_DB.exec("DELETE FROM emails");
    await env.EMAIL_DB.exec("DELETE FROM email_types");
  });

  describe("GET /api/emails", () => {
    it("returns empty list when no emails", async () => {
      const app = createApp();
      const res = await app.request("/api/emails", {}, env as unknown as Env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it("returns paginated emails", async () => {
      await seedData();
      const app = createApp();
      const res = await app.request("/api/emails", {}, env as unknown as Env);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("01ABC123");
      expect(body.pagination.total).toBe(1);
    });

    it("filters by type", async () => {
      await seedData();
      const app = createApp();

      const res = await app.request(
        "/api/emails?type=creditcard",
        {},
        env as unknown as Env
      );
      const body = await res.json();
      expect(body.data).toHaveLength(1);

      const res2 = await app.request(
        "/api/emails?type=payslip",
        {},
        env as unknown as Env
      );
      const body2 = await res2.json();
      expect(body2.data).toHaveLength(0);
    });

    it("filters by date range", async () => {
      await seedData();
      const app = createApp();

      const res = await app.request(
        "/api/emails?from=2026-03-01&to=2026-03-31",
        {},
        env as unknown as Env
      );
      const body = await res.json();
      expect(body.data).toHaveLength(1);

      const res2 = await app.request(
        "/api/emails?from=2026-04-01",
        {},
        env as unknown as Env
      );
      const body2 = await res2.json();
      expect(body2.data).toHaveLength(0);
    });
  });

  describe("GET /api/emails/:id", () => {
    it("returns email with attachments", async () => {
      await seedData();
      const app = createApp();
      const res = await app.request(
        "/api/emails/01ABC123",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe("01ABC123");
      expect(body.data.attachments).toHaveLength(1);
      expect(body.data.attachments[0].filename).toBe("statement.pdf");
    });

    it("returns 404 for non-existent email", async () => {
      const app = createApp();
      const res = await app.request(
        "/api/emails/nonexistent",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/emails/:id/attachments/:aid", () => {
    it("returns 404 when attachment does not exist", async () => {
      await seedData();
      const app = createApp();
      const res = await app.request(
        "/api/emails/01ABC123/attachments/nonexistent",
        {},
        env as unknown as Env
      );
      expect(res.status).toBe(404);
    });
  });
});
