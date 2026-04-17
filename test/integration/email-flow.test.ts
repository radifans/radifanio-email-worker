import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/db/schema";
import { app } from "../../src/api/app";
import type { Env } from "../../src/env";

const db = drizzle(env.EMAIL_DB, { schema });

describe("Integration: Email API flow", () => {
  beforeEach(async () => {
    await env.EMAIL_DB.exec("DELETE FROM attachments");
    await env.EMAIL_DB.exec("DELETE FROM emails");
    await env.EMAIL_DB.exec("DELETE FROM email_types");
  });

  it("full flow: create type → verify via API → list types", async () => {
    // Create a type
    const createRes = await app.request(
      "/api/types",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "test-api-key-12345",
        },
        body: JSON.stringify({
          id: "creditcard",
          emailPrefix: "creditcard",
          displayName: "Credit Card Statement",
          description: "Monthly CC statements",
        }),
      },
      env as unknown as Env
    );
    expect(createRes.status).toBe(201);

    // List types
    const listRes = await app.request(
      "/api/types",
      { headers: { "X-API-Key": "test-api-key-12345" } },
      env as unknown as Env
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data).toHaveLength(1);

    // Get single type
    const getRes = await app.request(
      "/api/types/creditcard",
      { headers: { "X-API-Key": "test-api-key-12345" } },
      env as unknown as Env
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data.displayName).toBe("Credit Card Statement");
    expect(getBody.data.emailCount).toBe(0);
  });

  it("emails endpoint returns 401 without API key", async () => {
    const res = await app.request(
      "/api/emails",
      {},
      env as unknown as Env
    );
    expect(res.status).toBe(401);
  });

  it("health endpoint does not require auth", async () => {
    const res = await app.request(
      "/api/health",
      {},
      env as unknown as Env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
