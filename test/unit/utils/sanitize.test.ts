import { describe, it, expect } from "vitest";
import { sanitizeFilename, deduplicateFilename } from "../../../src/utils/sanitize";

describe("sanitizeFilename", () => {
  it("returns the filename unchanged if already safe", () => {
    expect(sanitizeFilename("statement.pdf")).toBe("statement.pdf");
  });

  it("removes path traversal sequences", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32")).toBe("system32");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeFilename('file<name>:with"bad|chars?.pdf')).toBe(
      "file_name__with_bad_chars_.pdf"
    );
  });

  it("truncates long filenames to 200 characters preserving extension", () => {
    const longName = "a".repeat(250) + ".pdf";
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/\.pdf$/);
  });

  it("handles filenames with no extension", () => {
    const longName = "a".repeat(250);
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("returns 'unnamed' for empty or whitespace-only input", () => {
    expect(sanitizeFilename("")).toBe("unnamed");
    expect(sanitizeFilename("   ")).toBe("unnamed");
  });

  it("strips leading/trailing dots and spaces", () => {
    expect(sanitizeFilename("  .hidden.pdf  ")).toBe("hidden.pdf");
  });
});

describe("deduplicateFilename", () => {
  it("returns original filename if no duplicates exist", () => {
    const result = deduplicateFilename("report.pdf", []);
    expect(result).toBe("report.pdf");
  });

  it("appends -1 if filename already exists", () => {
    const result = deduplicateFilename("report.pdf", ["report.pdf"]);
    expect(result).toBe("report-1.pdf");
  });

  it("increments suffix until unique", () => {
    const result = deduplicateFilename("report.pdf", [
      "report.pdf",
      "report-1.pdf",
      "report-2.pdf",
    ]);
    expect(result).toBe("report-3.pdf");
  });

  it("handles files with no extension", () => {
    const result = deduplicateFilename("readme", ["readme"]);
    expect(result).toBe("readme-1");
  });
});
