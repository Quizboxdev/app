import { describe, expect, it } from "vitest";
import { DRAFT_LABEL, expiresSoon, timeLeft } from "./format";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

describe("draft time left", () => {
  it("reads naturally", () => {
    expect(timeLeft(at(24 * 60), NOW)).toBe("24h"); expect(timeLeft(at(190), NOW)).toBe("3h 10m"); expect(timeLeft(at(45), NOW)).toBe("45 min");
    expect(timeLeft(NOW + 20_000, NOW)).toBe("less than a minute"); expect(timeLeft(at(-1), NOW)).toBe("expired"); expect(timeLeft("not a date", NOW)).toBe("expired");
  });
  it("warns inside the last two hours only", () => {
    expect(expiresSoon(at(120), NOW)).toBe(true); expect(expiresSoon(at(121), NOW)).toBe(false); expect(expiresSoon(at(0), NOW)).toBe(false); expect(expiresSoon(at(-5), NOW)).toBe(false);
  });
  it("names every kind in the same words the database warning uses", () => {
    expect(Object.values(DRAFT_LABEL)).toEqual(["challenge", "competition", "sponsored competition", "practice set", "assignment", "work"]);
  });
});
