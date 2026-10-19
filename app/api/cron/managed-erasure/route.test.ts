import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The scheduled erasure endpoint: closed without the secret, counts only in its answer, one bad learner never stops the batch.
const rpc = vi.fn(), updateUserById = vi.fn();
vi.mock("@/lib/managed/server", () => ({ reply: (status: number, body: unknown) => Response.json(body, { status }), admin: () => ({ rpc, auth: { admin: { updateUserById } } }) }));
import { GET } from "./route";

const call = (token?: string) => GET(new Request("https://www.quizbox.io/api/cron/managed-erasure", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
const SECRET = "a-long-enough-cron-secret-value";

beforeEach(() => { rpc.mockReset(); updateUserById.mockReset(); process.env.CRON_SECRET = SECRET; });
afterEach(() => { delete process.env.CRON_SECRET; });

describe("managed erasure cron route", () => {
  it("is closed when no secret is configured and when the token is missing or wrong", async () => {
    delete process.env.CRON_SECRET; expect((await call(SECRET)).status).toBe(503);
    process.env.CRON_SECRET = "short"; expect((await call("short")).status).toBe(401);          // a weak secret is never accepted
    process.env.CRON_SECRET = SECRET;
    expect((await call()).status).toBe(401); expect((await call("wrong-secret-of-the-same-len!")).status).toBe(401); expect((await call(SECRET + "x")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("erases each due learner, scrambles the sign-in, and reports counts only", async () => {
    rpc.mockImplementation(async (name: string, args: any) => {
      if (name === "qb_managed_erasure_due") return { data: [{ user_id: "u1", months: 12 }, { user_id: "u2", months: 12 }, { user_id: "u3", months: 12 }], error: null };
      if (args.p_learner === "u2") return { data: null, error: { message: "QB_MANAGED_LEARNER_NOT_FOUND" } };
      return { data: { erased: true, already: false, login_email: `erased-${args.p_learner}@erased.invalid` }, error: null };
    });
    updateUserById.mockImplementation(async (id: string) => (id === "u3" ? { error: { message: "auth down" } } : { error: null }));
    const res = await call(SECRET); const body = await res.json();
    expect(res.status).toBe(200); expect(body).toEqual({ ok: true, due: 3, erased: 1, failed: 2 });
    expect(JSON.stringify(body)).not.toMatch(/u1|erased-/);
    expect(rpc).toHaveBeenCalledWith("qb_managed_learner_erase", { p_learner: "u1", p_reason: "Scheduled erasure: ended more than 12 months ago" });
    expect(updateUserById).toHaveBeenCalledWith("u1", expect.objectContaining({ email: "erased-u1@erased.invalid", ban_duration: "876000h" }));
  });

  it("does nothing when the switch is off (the database returns an empty list) and survives a read failure", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await (await call(SECRET)).json()).toEqual({ ok: true, due: 0, erased: 0, failed: 0 });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await call(SECRET)).status).toBe(502);
  });
});
