import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Payment checks route: only finance staff (decided by the database), only Paystack's answer, and refusals explained.
const userRpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "staff1" } }, error: null }) }, rpc: userRpc }) }));
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({}) }));
const find = vi.fn(), settle = vi.fn();
vi.mock("@/lib/payments/reconcile", () => ({ findPaymentIssues: (...a: unknown[]) => find(...a), settlePayment: (...a: unknown[]) => settle(...a) }));
import { POST } from "./route";

const req = (body: unknown, auth = true) => new Request("https://www.quizbox.io/api/admin/payment-checks", { method: "POST", headers: { ...(auth ? { authorization: "Bearer t" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_marker_9"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"); vi.spyOn(console, "error").mockImplementation(() => undefined);
  userRpc.mockResolvedValue({ data: [], error: null }); find.mockResolvedValue({ rows: [], checked: 0, unreachable: 0, since: "x" }); settle.mockResolvedValue({ state: "confirmed" }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); userRpc.mockReset(); find.mockReset(); settle.mockReset(); });

describe("POST /api/admin/payment-checks", () => {
  it("needs a signed-in caller and the finance gate, and does nothing for anyone else", async () => {
    expect((await POST(req({ action: "check" }, false))).status).toBe(401);
    userRpc.mockResolvedValue({ data: null, error: { message: "QB_FORBIDDEN" } });
    const res = await POST(req({ action: "check" }));
    expect(res.status).toBe(403); expect(find).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled();
    expect((await POST(req({ action: "settle", reference: "QB-abcdefgh1" }))).status).toBe(403); expect(settle).not.toHaveBeenCalled();
  });
  it("checks with a sensible look-back and returns the findings", async () => {
    find.mockResolvedValue({ rows: [{ reference: "QB-x" }], checked: 3, unreachable: 0, since: "s" });
    const res = await POST(req({ action: "check", days: 30 }));
    expect(await res.json()).toMatchObject({ ok: true, checked: 3, rows: [{ reference: "QB-x" }] });
    expect(find.mock.calls[0][2]).toEqual({ days: 30 });
    await POST(req({ action: "check", days: 9999 })); expect(find.mock.calls[1][2]).toEqual({ days: 14 });
  });
  it("settles one payment for the signed-in staff member, and explains when it cannot", async () => {
    expect(await (await POST(req({ action: "settle", reference: "QB-abcdefgh1" }))).json()).toMatchObject({ ok: true, state: "confirmed" });
    expect(settle.mock.calls[0].slice(2, 4)).toEqual(["staff1", "QB-abcdefgh1"]);
    settle.mockResolvedValue({ state: "failed" });
    expect(await (await POST(req({ action: "settle", reference: "QB-abcdefgh1" }))).json()).toMatchObject({ ok: false, error: expect.stringMatching(/does not show/) });
    settle.mockResolvedValue({ state: "pending", error: "fulfilment_failed" });
    expect(await (await POST(req({ action: "settle", reference: "QB-abcdefgh1" }))).json()).toMatchObject({ ok: false, error: expect.stringMatching(/not confirmed|failed/) });
  });
  it("refuses a bad reference or action, and never leaks the Paystack key", async () => {
    expect((await POST(req({ action: "settle", reference: "'; drop" }))).status).toBe(400);
    expect((await POST(req({ action: "delete" }))).status).toBe(400);
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect((await POST(req({ action: "check" }))).status).toBe(503);
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain("marker");
  });
});
