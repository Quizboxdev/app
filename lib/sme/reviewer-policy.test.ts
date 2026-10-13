import { describe, expect, it } from "vitest";
import { displayValue, parseReviewerPolicy, reviewerPolicy } from "./reviewer-policy";

describe("reviewer policy file", () => {
  it("loads and validates the committed policy", () => {
    const p = reviewerPolicy();
    expect(p.sections.map((s) => s.id)).toEqual(["eligibility", "workload", "pay", "quality", "support"]);
    expect(p.sections.find((s) => s.id === "workload")!.rules.find((r) => r.id === "daily_cap")).toMatchObject({ value: 100 });
  });
  it("never shows a made-up fee: owner-set values stay empty until entered", () => {
    const pay = reviewerPolicy().sections.find((s) => s.id === "pay")!;
    expect(displayValue(pay.rules.find((r) => r.id === "base_fee")!)).toBe("Not set (owner decision)");
    expect(displayValue({ id: "x", text: "t", value: 100, unit: "reviews" })).toBe("100 reviews");
  });
  it("rejects a malformed revision", () => {
    expect(() => parseReviewerPolicy(null)).toThrow("REVIEWER_POLICY_INVALID");
    expect(() => parseReviewerPolicy({ version: "1", status: "PROPOSED", updated: "2026-10-13", sections: [] })).toThrow("version");
    expect(() => parseReviewerPolicy({ version: "1.0.0", status: "DRAFT", updated: "2026-10-13", sections: [] })).toThrow("status");
    const dup = { version: "1.0.0", status: "APPROVED", updated: "2026-10-13", owner: "o", how_to_revise: "h",
      sections: [{ id: "a", title: "A", summary: "s", rules: [{ id: "r", text: "x" }, { id: "r", text: "y" }] }] };
    expect(() => parseReviewerPolicy(dup)).toThrow("duplicate rule a.r");
  });
});
