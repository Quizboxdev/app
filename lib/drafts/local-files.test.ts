import { describe, expect, it } from "vitest";
import { FILE_MAX_BYTES, FILE_TTL_MS, isExpired, withinLimit } from "./local-files";

describe("keeping chosen files in the browser", () => {
  it("accepts files up to the limit together and refuses more, or nothing at all", () => {
    expect(withinLimit([1_000_000, 2_000_000])).toBe(true);
    expect(withinLimit([FILE_MAX_BYTES])).toBe(true);
    expect(withinLimit([FILE_MAX_BYTES, 1])).toBe(false);
    expect(withinLimit([])).toBe(false);
    expect(withinLimit([-1])).toBe(false);
    expect(withinLimit([Number.NaN])).toBe(false);
  });
  it("expires after 24 hours, and distrusts a timestamp from the future or a broken one", () => {
    const now = 1_800_000_000_000;
    expect(isExpired(now - 3_600_000, now)).toBe(false);
    expect(isExpired(now - FILE_TTL_MS, now)).toBe(false);
    expect(isExpired(now - FILE_TTL_MS - 1, now)).toBe(true);
    expect(isExpired(now + 3_600_000, now)).toBe(true);
    expect(isExpired(Number.NaN, now)).toBe(true);
  });
});
