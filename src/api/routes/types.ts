import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, count } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../../env";

export const typesRoute = new Hono<{ Bindings: Env }>();

// GET /api/types — list all types
typesRoute.get("/", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const types = await db.select().from(schema.emailTypes);
  return c.json({ data: types });
});

// GET /api/types/:id — get type with email count
typesRoute.get("/:id", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const id = c.req.param("id");

  const emailType = await db.query.emailTypes.findFirst({
    where: eq(schema.emailTypes.id, id),
  });

  if (!emailType) {
    return c.json({ error: "Type not found" }, 404);
  }

  const [countResult] = await db
    .select({ count: count() })
    .from(schema.emails)
    .where(eq(schema.emails.typeId, id));

  return c.json({
    data: { ...emailType, emailCount: countResult.count },
  });
});

// POST /api/types — create new type
typesRoute.post("/", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const body = await c.req.json<{
    id?: string;
    emailPrefix?: string;
    displayName?: string;
    description?: string;
  }>();

  if (!body.id || !body.emailPrefix || !body.displayName) {
    return c.json(
      { error: "Missing required fields: id, emailPrefix, displayName" },
      400
    );
  }

  // Check for duplicate emailPrefix
  const existing = await db.query.emailTypes.findFirst({
    where: eq(schema.emailTypes.emailPrefix, body.emailPrefix),
  });
  if (existing) {
    return c.json({ error: "Email prefix already exists" }, 409);
  }

  const [created] = await db
    .insert(schema.emailTypes)
    .values({
      id: body.id,
      emailPrefix: body.emailPrefix,
      displayName: body.displayName,
      description: body.description || null,
    })
    .returning();

  return c.json({ data: created }, 201);
});

// PATCH /api/types/:id — update type
typesRoute.patch("/:id", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const id = c.req.param("id");

  const existing = await db.query.emailTypes.findFirst({
    where: eq(schema.emailTypes.id, id),
  });
  if (!existing) {
    return c.json({ error: "Type not found" }, 404);
  }

  const body = await c.req.json<{
    displayName?: string;
    description?: string;
    active?: number;
  }>();

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.description !== undefined) updates.description = body.description;
  if (body.active !== undefined) updates.active = body.active;

  const [updated] = await db
    .update(schema.emailTypes)
    .set(updates)
    .where(eq(schema.emailTypes.id, id))
    .returning();

  return c.json({ data: updated });
});
