import { describe, expect, it } from "vitest";
import { changeText, sortClasses } from "./dashboard";

describe("dashboard helpers", () => {
  it("words the change against the previous period", () => {
    expect(changeText(12, 10)).toBe("+20% vs last week");
    expect(changeText(5, 10)).toBe("-50% vs last week");
    expect(changeText(10, 10)).toBe("no change vs last week");
    expect(changeText(4, 0)).toBe("new vs last week");
    expect(changeText(0, 0)).toBe("no change vs last week");
    expect(changeText(3, 2, "the week before")).toBe("+50% vs the week before");
  });
  it("sorts classes in teaching order with unknown ones last", () => {
    expect(sortClasses([{ grade: "SHS1" }, { grade: "B10" }, { grade: "B4" }, { grade: "X1" }, { grade: "B7" }]).map((r) => r.grade)).toEqual(["B4", "B7", "B10", "SHS1", "X1"]);
  });
});
