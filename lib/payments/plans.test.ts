import { describe, expect, it } from "vitest";
import { resolveSellablePlan } from "./plans";

describe("resolveSellablePlan", () => {
  const rows = [
    { code: "plan_weekly", audience: "learner", coins: 5, days: 7 },
    { code: "plan_term", audience: "learner", coins: 25, days: 90 },
    { code: "seats_10", audience: "host", coins: 10, days: null },
    { code: "learner_free", audience: "learner", coins: null, days: null },
    { code: "bad_days", audience: "learner", coins: 5, days: 0 },
  ];
  it("finds a learner plan on the price list by its code, with Coins and days", () => {
    expect(resolveSellablePlan("plan_weekly", rows)).toEqual({ id: "plan_weekly", coins: 5, days: 7 });
    expect(resolveSellablePlan("plan_term", rows)).toEqual({ id: "plan_term", coins: 25, days: 90 });
  });
  it("refuses bundles, free plans, rows without Coins or days, and unknown codes", () => {
    for (const code of ["seats_10", "learner_free", "bad_days", "nope", ""]) expect(resolveSellablePlan(code, rows)).toBeUndefined();
  });
  it("still sells the older plan names from the plan file, and copes with a missing price list", () => {
    expect(resolveSellablePlan("learner_monthly", null)).toMatchObject({ id: "learner_monthly", coins: 10, days: 30 });
    expect(resolveSellablePlan("plan_weekly", undefined)).toBeUndefined();
  });
});
