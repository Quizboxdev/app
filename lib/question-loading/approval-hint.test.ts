import { describe, expect, it } from "vitest";
import { nothingToApprove } from "./approval-hint";

describe("why the approve button is off", () => {
  it("says a fully approved batch is already done", () => {
    expect(nothingToApprove({ "approved/active": 100 })).toMatch(/All 100 questions are already approved/);
    expect(nothingToApprove({ "approved/active": 1 })).toMatch(/All 1 question is already approved/);
  });
  it("says when questions are waiting but fail the automatic checks", () => {
    expect(nothingToApprove({ "review/inactive": 7 })).toMatch(/7 questions are waiting for review but none passes/);
  });
  it("covers an empty batch", () => {
    expect(nothingToApprove({})).toMatch(/no questions waiting/);
  });
});
