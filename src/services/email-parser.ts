import PostalMime from "postal-mime";

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  content: ArrayBuffer;
  size: number;
}

export interface ParsedEmail {
  from: string;
  subject: string;
  date: string | null;
  messageId: string | null;
  textBody: string | null;
  htmlBody: string | null;
  attachments: ParsedAttachment[];
}

export async function parseEmail(rawEmail: string | ArrayBuffer): Promise<ParsedEmail> {
  const parser = new PostalMime();
  const parsed = await parser.parse(rawEmail);

  return {
    from: parsed.from?.address || parsed.from?.name || "unknown",
    subject: parsed.subject || "",
    date: parsed.date || null,
    messageId: parsed.messageId || null,
    textBody: parsed.text || null,
    htmlBody: parsed.html || null,
    attachments: (parsed.attachments || []).map((att) => ({
      filename: att.filename || "unnamed",
      contentType: att.mimeType || "application/octet-stream",
      content: att.content,
      size: att.content.byteLength,
    })),
  };
}
