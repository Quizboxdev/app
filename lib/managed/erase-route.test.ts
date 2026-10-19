import { beforeEach, describe, expect, it, vi } from "vitest";

const state: any = { user: { id: "owner" }, isSuper: true, erase: { data: { erased: true, already: false, login_email: "erased-0000@erased.invalid" }, error: null }, update: vi.fn() };
const svc: any = { rpc: vi.fn(async () => state.erase), auth: { admin: { updateUserById: (id: string, a: any) => state.update(id, a) } } };
const client: any = { rpc: vi.fn(async (name: string) => name === "qb_sme_context" ? { data: { super_admin: state.isSuper }, error: null } : { data: null, error: null }) };
vi.mock("@/lib/managed/server", async (orig) => ({ ...(await orig<any>()), authenticate: async () => (state.user ? { client, user: state.user } : null), admin: () => svc }));

const LEARNER = "00000000-0000-4000-8000-000000000801";
const post = async (body: unknown) => (await import("../../app/api/admin/managed-learners/erase/route")).POST(new Request("https://www.quizbox.io/api/x", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("erase route", () => {
  beforeEach(() => { Object.assign(state, { user: { id: "owner" }, isSuper: true, erase: { data: { erased: true, already: false, login_email: "erased-0000@erased.invalid" }, error: null } }); state.update = vi.fn(async () => ({ error: null })); svc.rpc.mockClear(); });
  it("erases in the database, then scrambles the sign-in so the old username and password are dead", async () => {
    const res = await post({ learnerId: LEARNER, reason: "Written request from the parent" });
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ ok: true, already: false });
    expect(svc.rpc).toHaveBeenCalledWith("qb_managed_learner_erase", { p_learner: LEARNER, p_reason: "Written request from the parent" });
    const [id, attrs] = state.update.mock.calls[0];
    expect(id).toBe(LEARNER);
    expect(attrs).toMatchObject({ email: "erased-0000@erased.invalid", ban_duration: "876000h" });
    expect(attrs.password.length).toBeGreaterThanOrEqual(30);
  });
  it("is owner only, and needs a real reason and a valid id", async () => {
    state.isSuper = false; expect((await post({ learnerId: LEARNER, reason: "Written request from the parent" })).status).toBe(403);
    state.isSuper = true; state.user = null; expect((await post({ learnerId: LEARNER, reason: "Written request from the parent" })).status).toBe(401);
    state.user = { id: "owner" };
    expect((await post({ learnerId: LEARNER, reason: "no" })).status).toBe(400);
    expect((await post({ learnerId: "x", reason: "Written request from the parent" })).status).toBe(400);
    expect(svc.rpc).not.toHaveBeenCalled();
  });
  it("does not scramble again for an already-erased learner, and reports a learner that is not managed", async () => {
    state.erase = { data: { erased: true, already: true }, error: null };
    expect(await (await post({ learnerId: LEARNER, reason: "Repeat of an earlier request" })).json()).toEqual({ ok: true, already: true });
    expect(state.update).not.toHaveBeenCalled();
    state.erase = { data: null, error: { message: "QB_MANAGED_LEARNER_NOT_FOUND" } };
    expect((await post({ learnerId: LEARNER, reason: "Written request from the parent" })).status).toBe(404);
  });
});
