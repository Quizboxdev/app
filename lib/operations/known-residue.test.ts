import { describe, expect, it } from "vitest";
import { KNOWN_RESIDUE, assertRunId } from "./live-fixture";

describe("known fixture residue", () => {
  it("lists only well-formed run ids, each with a reason", () => {
    for (const [runId, why] of Object.entries(KNOWN_RESIDUE)) { expect(() => assertRunId(runId)).not.toThrow(); expect(why.length).toBeGreaterThan(20); }
  });
  it("stays small, so it cannot become a place to hide failures", () => { expect(Object.keys(KNOWN_RESIDUE).length).toBeLessThanOrEqual(3); });
});
