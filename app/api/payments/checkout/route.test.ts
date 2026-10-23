import { afterEach, describe, expect, it, vi } from "vitest";

// Audit follow-up: a refused checkout says why (a short code) and logs it, so "not open yet" is never a guess.
const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));
import { POST } from "./route";

const request = (body: unknown = { planId: "weekly" }) => new Request("https://www.quizbox.io/api/payments/checkout", { method: "POST", headers: { authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify(body) });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); rpc.mockReset(); });

describe("POST /api/payments/checkout refusals", () => {
  it("needs a signed-in caller", async () => {
    const res = await POST(new Request("https://www.quizbox.io/api/payments/checkout", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });
  it("says NO_PROVIDER_KEY when the Paystack key is not in this deployment", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "NO_PROVIDER_KEY" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("NO_PROVIDER_KEY"));
  });
  it("says PLAN_NOT_SOLD, and how many price rows the server could read, when the plan is unknown", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_not_a_real_key");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await POST(request({ planId: "no_such_plan" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: "PLAN_NOT_SOLD" });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/PLAN_NOT_SOLD.*priceRows=0/));
  });
  it("never puts the secret key in a response or a log line", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_marker_secret_123");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(request({ planId: "no_such_plan" }));
    expect(JSON.stringify(await res.json())).not.toContain("marker_secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("marker_secret");
  });
  it("buying Coins on their own accepts only whole numbers from 5 to 1000, and never asks the price list", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_not_a_real_key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const coins of [4, 0, -5, 1001, 2.5, "abc", null]) {
      const res = await POST(request({ coins }));
      expect(res.status, String(coins)).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, code: "INVALID_COINS" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a request that names a plan is a plan purchase, whatever else it carries", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_not_a_real_key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await POST(request({ planId: "no_such_plan", coins: 50 }));
    expect(await res.json()).toMatchObject({ code: "PLAN_NOT_SOLD" });
  });
});
