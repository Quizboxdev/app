import { describe, expect, it } from "vitest";
import { secretMatches } from "./secret";

describe("secretMatches", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches("s3cret-value-123", "s3cret-value-123")).toBe(true);
    expect(secretMatches("s3cret-value-124", "s3cret-value-123")).toBe(false);
    expect(secretMatches("S3CRET-VALUE-123", "s3cret-value-123")).toBe(false);
  });
  it("rejects a shorter, longer, empty or missing secret without throwing", () => {
    expect(secretMatches("s3cret", "s3cret-value-123")).toBe(false);
    expect(secretMatches("s3cret-value-123-and-more", "s3cret-value-123")).toBe(false);
    expect(secretMatches("", "s3cret-value-123")).toBe(false);
    expect(secretMatches(null, "s3cret-value-123")).toBe(false);
    expect(secretMatches(undefined, "s3cret-value-123")).toBe(false);
  });
  it("never accepts anything when no secret is configured", () => {
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("anything", "")).toBe(false);
    expect(secretMatches("anything", undefined)).toBe(false);
    expect(secretMatches(null, null)).toBe(false);
  });
});
