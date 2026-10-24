import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, logFallback } from "./log";

afterEach(() => vi.restoreAllMocks());
describe("fallback logging", () => {
  it("describes errors on one short line, whatever was thrown", () => {
    expect(describeError(new TypeError("fetch failed"))).toBe("TypeError: fetch failed");
    expect(describeError({ message: "boom\n  with   spaces" })).toBe("boom with spaces");
    expect(describeError("a string")).toBe("unknown error"); expect(describeError(null)).toBe("unknown error");
    expect(describeError(new Error("x".repeat(1000))).length).toBeLessThanOrEqual(200);
  });
  it("writes the area tag first, so the log can be searched", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logFallback("challenges", "leaderboard unavailable", new Error("timeout"));
    expect(log).toHaveBeenCalledWith("[challenges] leaderboard unavailable: Error: timeout");
  });
});
