import { describe, expect, it } from "vitest";
import { fromMinor, groupPrices, priceLabel, toMinor } from "./format";

describe("price wording", () => {
  it("shows free, announced and real prices, never a broken one", () => {
    expect(priceLabel({ price_minor: null, currency: "GHS", period: "month" })).toEqual({ amount: "Price to be announced", per: "", announced: true });
    expect(priceLabel({ price_minor: 0, currency: "GHS", period: "free" })).toEqual({ amount: "Free", per: "", announced: false });
    expect(priceLabel({ price_minor: 2500, currency: "GHS", period: "month" })).toEqual({ amount: "GHS 25", per: "per month", announced: false });
    expect(priceLabel({ price_minor: 12050, currency: "GHS", period: "campaign" })).toEqual({ amount: "GHS 120.50", per: "per quiz", announced: false });
  });
  it("turns cedis typed by an admin into pesewas and back, and refuses nonsense", () => {
    expect(toMinor("25")).toBe(2500); expect(toMinor("25.5")).toBe(2550); expect(toMinor(" 1,200.99 ")).toBe(120099); expect(toMinor("")).toBeNull(); expect(toMinor("0")).toBe(0);
    for (const bad of ["-5", "abc", "1.234", "GHS 5", "1e3"]) expect(() => toMinor(bad)).toThrow();
    expect(fromMinor(2500)).toBe("25"); expect(fromMinor(2550)).toBe("25.50"); expect(fromMinor(null)).toBe("");
  });
  it("groups rows under the three headings and leaves out empty ones", () => {
    const g = groupPrices([{ audience: "learner" as const }, { audience: "teacher" as const }, { audience: "school" as const }, { audience: "company" as const }]);
    expect(g.map((x) => [x.id, x.rows.length])).toEqual([["learners", 1], ["schools", 2], ["sponsors", 1]]);
    expect(groupPrices([{ audience: "learner" as const }]).map((x) => x.id)).toEqual(["learners"]);
  });
});
