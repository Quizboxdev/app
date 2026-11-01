import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR_MESSAGE, userFacingError } from "./errors";

// Lost-connection wording (audit UX-022): a dropped connection must not read as a server fault.
const GENERIC = "The operation could not be completed. Please try again or contact support.";
afterEach(() => vi.unstubAllGlobals());

describe("userFacingError", () => {
  it("says the connection dropped for the failed-fetch wording of each major browser", () => {
    for (const text of ["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "TypeError: Network request failed", "fetch failed"]) {
      expect(userFacingError(new TypeError(text))).toBe(NETWORK_ERROR_MESSAGE);
      expect(userFacingError({ message: text })).toBe(NETWORK_ERROR_MESSAGE);
    }
  });
  it("says the same when the browser reports it is offline, whatever the error text", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(userFacingError({ message: "something unexpected" })).toBe(NETWORK_ERROR_MESSAGE);
  });
  it("keeps known codes and the generic wording for real server errors", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(userFacingError({ message: "AUTH_REQUIRED" })).toBe("Please sign in again.");
    expect(userFacingError({ message: "canceling statement due to statement timeout" })).toBe(GENERIC);
    expect(userFacingError("plain text error")).toBe(GENERIC);
  });
  it("lets a known code win even when the browser is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(userFacingError({ message: "AUTH_REQUIRED" })).toBe("Please sign in again.");
  });
});

describe("userFacingErrorWithDetail", () => {
  it("keeps the friendly sentence for a known reason, with no technical text", async () => {
    const { userFacingErrorWithDetail } = await import("./errors");
    expect(userFacingErrorWithDetail({ message: "QB_BATCH_IS_LIVE", code: "P0001" })).toBe(userFacingError({ message: "QB_BATCH_IS_LIVE" }));
  });
  it("names a database time-out in plain words, and shows the code for anything unknown", async () => {
    const { userFacingErrorWithDetail } = await import("./errors");
    expect(userFacingErrorWithDetail({ code: "57014", message: "canceling statement due to statement timeout" })).toMatch(/took too long.*57014/);
    expect(userFacingErrorWithDetail({ code: "23514", message: "violates check constraint" })).toBe("The operation could not be completed. Please try again or contact support. (Technical detail: 23514 · violates check constraint)");
    expect(userFacingErrorWithDetail("odd")).toBe("The operation could not be completed. Please try again or contact support. (Technical detail: odd)");
  });
});
