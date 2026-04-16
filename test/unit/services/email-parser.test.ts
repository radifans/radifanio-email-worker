import { describe, it, expect } from "vitest";
import { parseEmail, type ParsedEmail } from "../../../src/services/email-parser";

// Inlined fixture — node:fs is unavailable in the Miniflare Workers test environment
const sampleEml = `From: bank@example.com
To: creditcard@automation.example.com
Subject: Your March 2026 Credit Card Statement
Date: Sat, 15 Mar 2026 10:30:00 +0000
MIME-Version: 1.0
Message-ID: <unique-msg-id-123@example.com>
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain; charset="utf-8"

Your credit card statement for March 2026 is attached.

--boundary123
Content-Type: text/html; charset="utf-8"

<html><body><p>Your credit card statement for March 2026 is attached.</p></body></html>

--boundary123
Content-Type: application/pdf; name="statement-march-2026.pdf"
Content-Disposition: attachment; filename="statement-march-2026.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2Jq

--boundary123--
`;

describe("parseEmail", () => {
  it("extracts sender address", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.from).toBe("bank@example.com");
  });

  it("extracts subject", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.subject).toBe("Your March 2026 Credit Card Statement");
  });

  it("extracts date", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.date).toBeTruthy();
  });

  it("extracts text body", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.textBody).toContain("March 2026");
  });

  it("extracts HTML body", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.htmlBody).toContain("<p>");
  });

  it("extracts attachments with filename and content type", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("statement-march-2026.pdf");
    expect(result.attachments[0].contentType).toBe("application/pdf");
  });

  it("attachment content is an ArrayBuffer", async () => {
    const result = await parseEmail(sampleEml);
    expect(result.attachments[0].content).toBeInstanceOf(ArrayBuffer);
    expect(result.attachments[0].size).toBeGreaterThan(0);
  });
});
