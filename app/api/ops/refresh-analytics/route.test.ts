import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The operations endpoint stays closed to anyone without the shared secret (audit QB-AUD-008: compared in constant time).
const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));
import { POST } from "./route";

const call = (secret?: string) => POST(new Request("https://www.quizbox.io/api/ops/refresh-analytics", { method: "POST", headers: secret === undefined ? {} : { "x-qb-ops-secret": secret } }));
beforeEach(() => { vi.stubEnv("QB_OPS_SECRET", "ops-secret-value-123456"); rpc.mockResolvedValue({ data: { ok: true }, error: null }); });
afterEach(() => { vi.unstubAllEnvs(); rpc.mockReset(); });

describe("POST /api/ops/refresh-analytics", () => {
  it("refuses a missing, wrong, shorter or longer secret and does nothing", async () => {
    for (const s of [undefined, "", "wrong", "ops-secret-value-12345", "ops-secret-value-1234567"]) expect((await call(s)).status, String(s)).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("is closed to everyone when no secret is configured", async () => {
    vi.stubEnv("QB_OPS_SECRET", "");
    expect((await call("")).status).toBe(401); expect((await call("anything")).status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it("runs the refresh for the right secret", async () => {
    const res = await call("ops-secret-value-123456");
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ status: "PASS" }); expect(rpc).toHaveBeenCalledTimes(2);
  });
});
