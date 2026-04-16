import { generateUlid } from "../utils/ulid";
import type { StorageResult } from "./storage";

export interface EmailProcessedEvent {
  eventType: "email.received";
  eventId: string;
  timestamp: string;
  emailId: string;
  typeId: string;
  typeName: string;
  from: string;
  subject: string;
  receivedAt: string;
  storagePrefix: string;
  bodyHtmlKey: string | null;
  bodyTextKey: string | null;
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    storageKey: string;
  }[];
}

export async function publishEmailEvent(
  queue: Queue<unknown>,
  params: {
    emailId: string;
    typeId: string;
    typeName: string;
    from: string;
    subject: string;
    receivedAt: string;
    storagePrefix: string;
    storageResult: StorageResult;
    attachmentIds: string[];
  }
): Promise<void> {
  const event: EmailProcessedEvent = {
    eventType: "email.received",
    eventId: generateUlid(),
    timestamp: new Date().toISOString(),
    emailId: params.emailId,
    typeId: params.typeId,
    typeName: params.typeName,
    from: params.from,
    subject: params.subject,
    receivedAt: params.receivedAt,
    storagePrefix: params.storagePrefix,
    bodyHtmlKey: params.storageResult.bodyHtmlKey,
    bodyTextKey: params.storageResult.bodyTextKey,
    attachments: params.storageResult.attachmentKeys.map((att, i) => ({
      id: params.attachmentIds[i],
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      storageKey: att.storageKey,
    })),
  };

  await queue.send(event);
}
