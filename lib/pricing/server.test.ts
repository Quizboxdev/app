import { afterEach, describe, expect, it, vi } from "vitest";

// Audit defect QB-AUD-002: when the price list cannot be read, the pricing page falls back to placeholders. That must be visible in the logs, never silent.
const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));
import { FALLBACK_PRICES, getPrices } from "./server";

afterEach(() => { vi.restoreAllMocks(); rpc.mockReset(); });

describe("getPrices", () => {
  it("returns the price list when the database answers", async () => {
    rpc.mockResolvedValue({ data: [{ code: "monthly", kind: "plan" }], error: null });
    expect(await getPrices()).toEqual([{ code: "monthly", kind: "plan" }]);
  });
  it("falls back, and says why, when the database returns an error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await getPrices()).toBe(FALLBACK_PRICES);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[pricing]"), expect.stringContaining("permission denied"));
  });
  it("falls back, and says why, when the server key is missing and the client cannot be built", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockRejectedValue(new Error("Server-side Supabase admin environment variables are missing."));
    expect(await getPrices()).toBe(FALLBACK_PRICES);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[pricing]"), expect.stringContaining("missing"));
  });
  it("falls back, and says so, when the list is empty", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getPrices()).toBe(FALLBACK_PRICES);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[pricing]"), "the list is empty");
  });
});
