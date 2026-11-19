import { describe, expect, it } from "vitest";
import { attemptDurationMs, durationText } from "./attempt-time";

describe("attemptDurationMs", () => {
  it("uses a ready-made duration first", () => { expect(attemptDurationMs({ duration_ms: 90000, time_spent_seconds: 5 })).toBe(90000); });
  it("reads seconds fields", () => { expect(attemptDurationMs({ time_spent_seconds: 125 })).toBe(125000); expect(attemptDurationMs({ duration_seconds: "30" })).toBe(30000); });
  it("works out the gap between start and submit", () => { expect(attemptDurationMs({ started_at: "2026-11-19T10:00:00Z", submitted_at: "2026-11-19T10:04:30Z" })).toBe(270000); });
  it("returns null when nothing usable is there", () => {
    expect(attemptDurationMs(null)).toBeNull();
    expect(attemptDurationMs({})).toBeNull();
    expect(attemptDurationMs({ started_at: "2026-11-19T10:05:00Z", submitted_at: "2026-11-19T10:00:00Z" })).toBeNull();
    expect(attemptDurationMs({ duration_ms: 0 })).toBeNull();
  });
});

describe("durationText", () => {
  it("reads plainly", () => { expect(durationText(45000)).toBe("45 sec"); expect(durationText(120000)).toBe("2 min"); expect(durationText(272000)).toBe("4 min 32 sec"); });
});
