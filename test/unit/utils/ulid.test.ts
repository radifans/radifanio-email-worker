import { describe, it, expect } from "vitest";
import { generateUlid } from "../../../src/utils/ulid";

describe("generateUlid", () => {
  it("returns a 26-character string", () => {
    const id = generateUlid();
    expect(id).toHaveLength(26);
  });

  it("returns uppercase Crockford base32 characters", () => {
    const id = generateUlid();
    expect(id).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUlid()));
    expect(ids.size).toBe(100);
  });

  it("generates sortable IDs (later calls produce larger values)", async () => {
    const first = generateUlid();
    await new Promise((r) => setTimeout(r, 2));
    const second = generateUlid();
    expect(second > first).toBe(true);
  });
});
