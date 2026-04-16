import type { ParsedEmail } from "./email-parser";
import { sanitizeFilename, deduplicateFilename } from "../utils/sanitize";

export interface StorageResult {
  rawKey: string;
  bodyHtmlKey: string | null;
  bodyTextKey: string | null;
  attachmentKeys: { filename: string; storageKey: string; size: number; contentType: string }[];
}

export async function storeEmail(
  bucket: R2Bucket,
  storagePrefix: string,
  rawEmailData: ArrayBuffer | string,
  parsed: ParsedEmail
): Promise<StorageResult> {
  const rawKey = `${storagePrefix}/raw.eml`;

  // Store raw email first (preserve original no matter what)
  const rawBody =
    typeof rawEmailData === "string"
      ? new TextEncoder().encode(rawEmailData)
      : rawEmailData;
  await bucket.put(rawKey, rawBody);

  // Parallel uploads for parsed content and attachments
  const uploads: Promise<void>[] = [];
  let bodyHtmlKey: string | null = null;
  let bodyTextKey: string | null = null;

  if (parsed.htmlBody) {
    bodyHtmlKey = `${storagePrefix}/body.html`;
    uploads.push(
      bucket.put(bodyHtmlKey, new TextEncoder().encode(parsed.htmlBody)).then(() => {})
    );
  }

  if (parsed.textBody) {
    bodyTextKey = `${storagePrefix}/body.txt`;
    uploads.push(
      bucket.put(bodyTextKey, new TextEncoder().encode(parsed.textBody)).then(() => {})
    );
  }

  const existingNames: string[] = [];
  const attachmentKeys: StorageResult["attachmentKeys"] = [];

  for (const att of parsed.attachments) {
    const safeName = sanitizeFilename(att.filename);
    const uniqueName = deduplicateFilename(safeName, existingNames);
    existingNames.push(uniqueName);

    const storageKey = `${storagePrefix}/attachments/${uniqueName}`;
    attachmentKeys.push({
      filename: uniqueName,
      storageKey,
      size: att.size,
      contentType: att.contentType,
    });

    uploads.push(
      bucket
        .put(storageKey, att.content, {
          httpMetadata: { contentType: att.contentType },
        })
        .then(() => {})
    );
  }

  await Promise.all(uploads);

  return { rawKey, bodyHtmlKey, bodyTextKey, attachmentKeys };
}
