import { describe, expect, it } from "vitest";
import { countChoices } from "./practice";

describe("quick practice count choices", () => {
  it("offers 5, 10, 15, 20 and 30 up to what the ticked topics can supply", () => {
    expect(countChoices(100)).toEqual([5, 10, 15, 20, 30]);
    expect(countChoices(18)).toEqual([5, 10, 15]);
    expect(countChoices(7)).toEqual([5]);
  });
  it("offers the small remainder when fewer than 5 questions exist, and nothing below 3", () => {
    expect(countChoices(4)).toEqual([4]);
    expect(countChoices(3)).toEqual([3]);
    expect(countChoices(2)).toEqual([]);
    expect(countChoices(0)).toEqual([]);
  });
});
