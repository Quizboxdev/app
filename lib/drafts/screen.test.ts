import { describe, expect, it } from "vitest";
import { DRAFT_MAX_CHARS, draftTitle, fitsDraft, sameData, scrub, screenScope } from "./screen";

describe("what an admin draft may contain", () => {
  it("removes secrets at any depth, whatever they are called", () => {
    const form = { name: "PROOF School", client_secret: "shh", secret: "x", apiKey: "k", nested: { Password: "p", note: "keep me", accessToken: "t", list: [{ api_key: "z", ok: 1 }] }, authorization: "Bearer abc" };
    expect(scrub(form)).toEqual({ name: "PROOF School", nested: { note: "keep me", list: [{ ok: 1 }] } });
  });
  it("also drops any field the screen names itself", () => {
    expect(scrub({ a: 1, issuer: "https://x", jwks: "y" }, ["JWKS"])).toEqual({ a: 1, issuer: "https://x" });
  });
  it("leaves out anything that is not plain data, such as files and functions", () => {
    const f = new Uint8Array([1, 2, 3]);
    expect(scrub({ name: "x", file: f, run: () => 1, when: new Date(0), n: NaN, ok: true })).toEqual({ name: "x", ok: true });
  });
  it("treats an unchanged form as nothing to save", () => {
    const base = { title: "", body: "# Title", audiences: ["everyone"], sort: 100 };
    expect(sameData({ ...base }, base)).toBe(true);
    expect(sameData({ ...base, title: "Hello" }, base)).toBe(false);
    expect(sameData({ ...base, client_secret: "typed" }, base)).toBe(true);   // a secret alone is never a reason to save
  });
  it("refuses a payload that would be rejected for size", () => {
    expect(fitsDraft({ text: "a".repeat(1000) })).toBe(true);
    expect(fitsDraft({ text: "a".repeat(DRAFT_MAX_CHARS) })).toBe(false);
  });
  it("builds scope keys and titles the holder accepts", () => {
    expect(screenScope("help")).toBe("admin-help");
    expect(screenScope("question loading", "B4/History 550!")).toBe("admin-question-loading-B4-History-550");
    expect(screenScope("x".repeat(100)).length).toBeLessThanOrEqual(64);
    expect(/^[A-Za-z0-9_-]{1,64}$/.test(screenScope("curriculum sources", "a b"))).toBe(true);
    expect(draftTitle("Help guide", "  Join a class ")).toBe("Help guide: Join a class");
    expect(draftTitle("Load questions", "x".repeat(300)).length).toBe(120);
    expect(draftTitle("Load questions", "   ")).toBe("Load questions");
  });
});
