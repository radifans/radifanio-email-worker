import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../env";
import { generateUlid } from "../utils/ulid";
import { parseEmail } from "../services/email-parser";
import { storeEmail } from "../services/storage";
import { publishEmailEvent } from "../services/queue";

function extractLocalPart(address: string): string {
  const atIndex = address.indexOf("@");
  return atIndex > 0 ? address.slice(0, atIndex).toLowerCase() : address.toLowerCase();
}

function buildStoragePrefix(typeId: string, date: Date, emailId: string): string {
  const yyyy = date.getFullYear().toString();
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${typeId}/${yyyy}/${mm}/${dd}/${emailId}`;
}

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const db = drizzle(env.EMAIL_DB, { schema });
  const emailId = generateUlid();
  const toAddress = message.to;
  const fromAddress = message.from;

  // Read raw email
  const rawEmail = await new Response(message.raw).arrayBuffer();

  // Resolve type
  const localPart = extractLocalPart(toAddress);
  let emailType = await db.query.emailTypes.findFirst({
    where: eq(schema.emailTypes.emailPrefix, localPart),
  });

  // If no type found, use "unknown"
  if (!emailType) {
    // Ensure "unknown" type exists
    const unknownType = await db.query.emailTypes.findFirst({
      where: eq(schema.emailTypes.id, "unknown"),
    });
    if (!unknownType) {
      await db.insert(schema.emailTypes).values({
        id: "unknown",
        emailPrefix: "__unknown__",
        displayName: "Unknown",
        description: "Emails with no matching type mapping",
        active: 1,
      });
    }
    emailType = {
      id: "unknown",
      emailPrefix: "__unknown__",
      displayName: "Unknown",
      description: "Emails with no matching type mapping",
      active: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Parse email
  let parsed;
  try {
    parsed = await parseEmail(rawEmail);
  } catch (err) {
    // Store raw email even if parsing fails
    const storagePrefix = buildStoragePrefix(
      emailType.id,
      new Date(),
      emailId
    );
    await env.EMAIL_STORAGE.put(`${storagePrefix}/raw.eml`, rawEmail);

    await db.insert(schema.emails).values({
      id: emailId,
      typeId: emailType.id,
      fromAddress,
      toAddress,
      subject: null,
      receivedAt: new Date().toISOString(),
      storagePrefix,
      rawSize: rawEmail.byteLength,
      status: "failed",
      errorMessage: `Email parsing failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const receivedAt = parsed.date || new Date().toISOString();
  const emailDate = new Date(receivedAt);
  const storagePrefix = buildStoragePrefix(emailType.id, emailDate, emailId);

  // Store to R2
  const storageResult = await storeEmail(
    env.EMAIL_STORAGE,
    storagePrefix,
    rawEmail,
    parsed
  );

  // Save metadata to D1
  const attachmentIds: string[] = [];

  await db.batch([
    db.insert(schema.emails).values({
      id: emailId,
      typeId: emailType.id,
      fromAddress,
      toAddress,
      subject: parsed.subject,
      receivedAt,
      storagePrefix,
      rawSize: rawEmail.byteLength,
      status: "received",
    }),
    ...storageResult.attachmentKeys.map((att) => {
      const attId = generateUlid();
      attachmentIds.push(attId);
      return db.insert(schema.attachments).values({
        id: attId,
        emailId,
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        storageKey: att.storageKey,
      });
    }),
  ]);

  // Publish to queue
  try {
    await publishEmailEvent(env.EMAIL_QUEUE, {
      emailId,
      typeId: emailType.id,
      typeName: emailType.displayName,
      from: fromAddress,
      subject: parsed.subject,
      receivedAt,
      storagePrefix,
      storageResult,
      attachmentIds,
    });
  } catch (err) {
    // Email is saved — queue failure is non-fatal
    console.error("Queue publish failed:", err);
  }
}
