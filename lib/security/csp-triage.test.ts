import { describe, expect, it } from "vitest";
import { formatCspTriage, parseCspLines, triageCsp } from "./csp-triage";

const LOG = [
  "2026-10-25 10:01:02 [csp] report directive=img-src blocked=https://cdn.example.com/logo.png page=/challenges/maths",
  "unrelated log line",
  "2026-10-25 10:02:03 [csp] report directive=img-src blocked=https://cdn.example.com/logo.png page=/challenges/science",
  "2026-10-25 10:03:04 [csp] report directive=script-src blocked=eval page=/play/quiz",
].join("\n");

describe("CSP log triage", () => {
  it("reads only the collector's lines and ignores everything else", () => {
    const lines = parseCspLines(LOG);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({ mode: "report", directive: "script-src", blocked: "eval", page: "/play/quiz" });
  });
  it("groups by directive and blocked address, most frequent first, with the pages affected", () => {
    const t = triageCsp(parseCspLines(LOG));
    expect(t.total).toBe(3);
    expect(t.groups[0]).toMatchObject({ directive: "img-src", blocked: "https://cdn.example.com/logo.png", count: 2 });
    expect(t.groups[0].pages).toEqual(["/challenges/maths", "/challenges/science"]);
    expect(t.verdict).toBe("REVIEW");
  });
  it("says CLEAN only for an empty log, and explains eval", () => {
    expect(triageCsp(parseCspLines("nothing here\n")).verdict).toBe("CLEAN");
    expect(formatCspTriage(triageCsp([]))).toMatch(/^CLEAN/);
    expect(formatCspTriage(triageCsp(parseCspLines(LOG)))).toContain("'eval' means a library needs unsafe-eval");
  });
});
