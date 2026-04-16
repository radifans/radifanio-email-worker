import { describe, it, expect } from "vitest";
import { parseEmail, type ParsedEmail } from "../../../src/services/email-parser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sampleEml = readFileSync(
  resolve(__dirname, "../../fixtures/sample-email.eml"),
  "utf-8"
);

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
