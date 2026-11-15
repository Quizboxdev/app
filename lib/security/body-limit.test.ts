import { describe, expect, it } from "vitest";
import { readBodyCapped } from "./body-limit";

const post = (body: string, headers: Record<string, string> = {}) => new Request("https://x.test/api", { method: "POST", body, headers });

describe("readBodyCapped", () => {
  it("returns a small body", async () => {
    expect(await readBodyCapped(post('{"a":1}'), 4096)).toBe('{"a":1}');
  });
  it("returns an empty string for no body", async () => {
    expect(await readBodyCapped(new Request("https://x.test/api", { method: "POST" }), 4096)).toBe("");
  });
  it("refuses a body over the limit", async () => {
    expect(await readBodyCapped(post("x".repeat(5000)), 4096)).toBeNull();
  });
  it("refuses at once when the declared length is over the limit, without reading", async () => {
    const req = new Request("https://x.test/api", { method: "POST", headers: { "content-length": "1000000" }, body: "tiny" });
    expect(await readBodyCapped(req, 4096)).toBeNull();
  });
  it("accepts a body exactly at the limit", async () => {
    expect(await readBodyCapped(post("y".repeat(4096)), 4096)).toHaveLength(4096);
  });
  it("keeps multi-byte text intact", async () => {
    expect(await readBodyCapped(post("Ɔ Ɛ é"), 4096)).toBe("Ɔ Ɛ é");
  });
});
