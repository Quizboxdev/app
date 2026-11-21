import { describe, expect, it } from "vitest";
import { freeAllowanceLine, pricingNote } from "./notes";

const base = { gated: true, free_limit: 5, used: 2, remaining: 3, subscribed: false };

describe("price sentences", () => {
  it("says cedis and 'nothing is charged until you press pay' once prices are live", () => { expect(pricingNote(true, true)).toMatch(/Ghana cedis.*Nothing is charged/); });
  it("says prices are being finalised when any are missing or payments are closed, with the same promise", () => {
    expect(pricingNote(false, true)).toMatch(/still being finalised.*Nothing is charged/);
    expect(pricingNote(true, false)).toMatch(/still being finalised/);
  });
});

describe("free practice line", () => {
  it("counts what is left", () => { expect(freeAllowanceLine(base)).toBe("You have 3 of 5 free practice sessions left."); });
  it("says it plainly when used up, and uses the singular", () => {
    expect(freeAllowanceLine({ ...base, used: 5, remaining: 0 })).toBe("You have used your 5 free practice sessions.");
    expect(freeAllowanceLine({ ...base, free_limit: 1, used: 0, remaining: 1 })).toBe("You have 1 of 1 free practice session left.");
  });
  it("says nothing for a subscriber, an ungated learner or a failed lookup", () => {
    expect(freeAllowanceLine({ ...base, subscribed: true })).toBeNull();
    expect(freeAllowanceLine({ ...base, gated: false })).toBeNull();
    expect(freeAllowanceLine(null)).toBeNull();
  });
});
