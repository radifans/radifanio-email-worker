import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, gte, lte, count, desc } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../../env";

export const emailsRoute = new Hono<{ Bindings: Env }>();

// GET /api/emails — list emails with filters and pagination
emailsRoute.get("/", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });

  const type = c.req.query("type");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  const conditions = [];
  if (type) conditions.push(eq(schema.emails.typeId, type));
  if (status) conditions.push(eq(schema.emails.status, status));
  if (from) conditions.push(gte(schema.emails.receivedAt, from));
  if (to) conditions.push(lte(schema.emails.receivedAt, to + "T23:59:59Z"));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db
    .select({ count: count() })
    .from(schema.emails)
    .where(where);

  const data = await db
    .select()
    .from(schema.emails)
    .where(where)
    .orderBy(desc(schema.emails.receivedAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    data,
    pagination: {
      page,
      limit,
      total: totalResult.count,
      totalPages: Math.ceil(totalResult.count / limit),
    },
  });
});

// GET /api/emails/:id — get email details with attachments
emailsRoute.get("/:id", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const id = c.req.param("id");

  const email = await db.query.emails.findFirst({
    where: eq(schema.emails.id, id),
  });

  if (!email) {
    return c.json({ error: "Email not found" }, 404);
  }

  const emailAttachments = await db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.emailId, id));

  return c.json({ data: { ...email, attachments: emailAttachments } });
});

// GET /api/emails/:id/attachments/:aid — download attachment
emailsRoute.get("/:id/attachments/:aid", async (c) => {
  const db = drizzle(c.env.EMAIL_DB, { schema });
  const emailId = c.req.param("id");
  const attachmentId = c.req.param("aid");

  const attachment = await db.query.attachments.findFirst({
    where: and(
      eq(schema.attachments.id, attachmentId),
      eq(schema.attachments.emailId, emailId)
    ),
  });

  if (!attachment) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  const object = await c.env.EMAIL_STORAGE.get(attachment.storageKey);
  if (!object) {
    return c.json({ error: "Attachment file not found in storage" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": attachment.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${attachment.filename}"`,
      "Content-Length": (attachment.size || 0).toString(),
    },
  });
});
