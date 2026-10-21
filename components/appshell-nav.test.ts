import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression guard (audit defect QB-AUD-001): every sidebar link must lead somewhere AppShell lets a signed-in user open. A link whose path prefix is missing from
// the allow-list sends the user straight back to their home page. The check reads the source, so it cannot tell WHICH role is allowed, only that no role is.
const src = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const block = src.slice(src.indexOf("const allowedPrefixes"), src.indexOf("const isAllowed"));
const allowed = new Set([...block.matchAll(/"(\/[a-z-]+)"/g)].map((m) => m[1]));
const navHrefs = [...src.matchAll(/\["(\/[a-z][a-z-]*)(?:\/[^"?]*)?(?:\?[^"]*)?",\s*"[^"]+"\]/g)].map((m) => m[1]);

describe("AppShell navigation", () => {
  it("finds the navigation and the allow-list in the source", () => {
    expect(allowed.size).toBeGreaterThan(8);
    expect(navHrefs.length).toBeGreaterThan(20);
  });
  it("never links to a page that no role is allowed to open", () => {
    const stranded = [...new Set(navHrefs)].filter((h) => !allowed.has(h));
    expect(stranded).toEqual([]);
  });
});
