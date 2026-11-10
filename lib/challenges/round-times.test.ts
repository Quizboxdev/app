import { describe, expect, it } from "vitest";
import { roundTimeProblems } from "./round-times";

const now = new Date("2026-11-10T12:00:00Z");

describe("roundTimeProblems", () => {
  it("accepts empty times and times in order in the future", () => {
    expect(roundTimeProblems(["", "", ""], now)).toEqual([]);
    expect(roundTimeProblems(["2026-11-12T10:00", "2026-11-14T10:00", "2026-11-16T10:00"], now)).toEqual([]);
  });
  it("flags a round that closes in the past", () => {
    const p = roundTimeProblems(["2026-11-09T10:00", "2026-11-14T10:00"], now);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ index: 0 });
    expect(p[0].message).toMatch(/Round 1 closes in the past/);
  });
  it("flags a round that closes before the previous one, skipping rounds with no time", () => {
    const p = roundTimeProblems(["2026-11-15T10:00", "", "2026-11-14T10:00"], now);
    expect(p).toHaveLength(1);
    expect(p[0].message).toMatch(/Round 3 closes before or at the same time as round 1/);
  });
  it("flags the same time twice and an unreadable value", () => {
    expect(roundTimeProblems(["2026-11-15T10:00", "2026-11-15T10:00"], now)).toHaveLength(1);
    expect(roundTimeProblems(["nonsense"], now)[0].message).toMatch(/not a date/);
  });
});
