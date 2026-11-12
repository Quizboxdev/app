import { describe, expect, it } from "vitest";
import { deadlineFrom, secondsLeft } from "./deadline";

describe("quiz deadline", () => {
  it("counts down from the seconds the server reported", () => {
    const deadline = deadlineFrom(600, 1_000_000);
    expect(secondsLeft(deadline, 1_000_000)).toBe(600);
    expect(secondsLeft(deadline, 1_000_000 + 59_000)).toBe(541);
  });

  it("is right straight after the student has been away, however long the browser slept", () => {
    const deadline = deadlineFrom(600, 0);
    expect(secondsLeft(deadline, 5 * 60_000)).toBe(300); // five minutes away: five minutes gone
    expect(secondsLeft(deadline, 11 * 60_000)).toBe(0); // away past the end: time is up, never negative
  });

  it("treats a missing or negative remaining time as already finished", () => {
    expect(secondsLeft(deadlineFrom(-5, 1000), 1000)).toBe(0);
    expect(secondsLeft(deadlineFrom(Number.NaN, 1000), 1000)).toBe(0);
  });
});
