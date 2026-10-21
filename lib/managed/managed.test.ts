import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePassword, generateUsername, parseNames, usernameToEmail, isManagedEmail, MANAGED_EMAIL_DOMAIN } from "./identity";

describe("managed learner identity", () => {
  it("makes readable usernames and passwords with no look-alike characters, and they differ each time", () => {
    const names = new Set(Array.from({ length: 200 }, () => generateUsername("Ama")));
    expect(names.size).toBeGreaterThan(190);
    for (const n of names) expect(n).toMatch(/^ama\.[a-hjkmnp-z2-9]{4}$/);
    for (let i = 0; i < 50; i++) expect(generatePassword()).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    expect(generateUsername("Zoë")).toMatch(/^zoe\.[a-z0-9]{4}$/);                                  // accents folded
    expect(generateUsername("123")).toMatch(/^learner\.[a-z0-9]{4}$/);                              // nothing usable: a neutral base
    expect(generateUsername("Maximilian-Bartholomew")).toMatch(/^maximilianba\./);                  // capped at 12 letters
  });
  it("turns a username into a sign-in address and leaves a real email alone", () => {
    expect(usernameToEmail("  Ama.K7F2 ")).toBe(`ama.k7f2@${MANAGED_EMAIL_DOMAIN}`);
    expect(usernameToEmail("Teacher@School.org")).toBe("teacher@school.org");
    expect(isManagedEmail(`ama.k7f2@${MANAGED_EMAIL_DOMAIN}`)).toBe(true);
    expect(isManagedEmail("ama@gmail.com")).toBe(false);
  });
  it("accepts plausible first names one per line, reports the rest, and caps the list", () => {
    expect(parseNames("Ama\n Kofi  \nEfua, Yaw;  Mary-Jane\nO'Neil")).toEqual({ names: ["Ama", "Kofi", "Efua", "Yaw", "Mary-Jane", "O'Neil"], rejected: [] });
    expect(parseNames("A\n<b>Kofi</b>\n12345\nKwame")).toEqual({ names: ["Kwame"], rejected: ["A", "<b>Kofi</b>", "12345"] });
    const many = parseNames(Array.from({ length: 70 }, (_, i) => `Name${String.fromCharCode(97 + (i % 26))}x`).join("\n"));
    expect(many.names).toHaveLength(60); expect(many.rejected).toHaveLength(10);
  });
});

// ---- routes, with the teacher's session and the service role mocked ----
const state: any = { user: { id: "t1" }, ctxError: null, budget: true, createUser: vi.fn(), deleteUser: vi.fn(), provision: vi.fn(), authorise: true, updateUser: vi.fn(), archive: { error: null } };
const svc: any = {
  rpc: vi.fn(async (name: string, args: any) => name === "qb_consume_budget" ? { data: state.budget, error: null } : name === "qb_managed_learner_provision" ? state.provision(args) : name === "qb_managed_learner_authorise" ? { data: state.authorise, error: null } : { data: null, error: null }),
  auth: { admin: { createUser: (a: any) => state.createUser(a), deleteUser: (id: string) => state.deleteUser(id), updateUserById: (id: string, a: any) => state.updateUser(id, a) } },
  from: () => ({ insert: async () => ({ error: null }) }),
};
const teacherClient: any = { rpc: vi.fn(async (name: string) => name === "qb_managed_class_context" ? (state.ctxError ? { data: null, error: { message: "QB_CLASS_NOT_MANAGED" } } : { data: { class_id: "c" }, error: null }) : name === "qb_managed_learner_archive" ? state.archive : { data: null, error: null }) };
vi.mock("@/lib/managed/server", async (orig) => ({ ...(await orig<any>()), authenticate: async () => (state.user ? { client: teacherClient, user: state.user } : null), admin: () => svc }));

const CLASS = "00000000-0000-4000-8000-000000000600", LEARNER = "00000000-0000-4000-8000-000000000801";
const call = async (path: string, body: unknown) => {
  const mod = await import(`../../app/api/teacher/learners${path}/route`);
  return mod.POST(new Request("https://www.quizbox.io/api/x", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) }));
};
const good = { classId: CLASS, names: ["Ama", "Kofi"], consentConfirmed: true, consentReference: "Class consent forms, term 1" };

describe("create learners route", () => {
  beforeEach(() => {
    Object.assign(state, { user: { id: "t1" }, ctxError: null, budget: true, authorise: true, archive: { error: null } });
    state.createUser = vi.fn(async (a: any) => ({ data: { user: { id: `u-${a.email}` } }, error: null }));
    state.deleteUser = vi.fn(async () => ({ error: null }));
    state.provision = vi.fn(async () => ({ data: {}, error: null }));
    state.updateUser = vi.fn(async () => ({ error: null }));
    svc.rpc.mockClear(); teacherClient.rpc.mockClear();
  });
  it("creates a sign-in and a full account per name and returns the credentials once", async () => {
    const res = await call("", good); const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.created).toHaveLength(2);
    for (const c of out.created) {
      expect(c.username).toMatch(/^[a-z]+\.[a-z0-9]{4}$/); expect(c.password).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(state.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: `${c.username}@${MANAGED_EMAIL_DOMAIN}`, password: c.password, email_confirm: true }));
    }
    expect(state.provision).toHaveBeenCalledTimes(2);
    expect(state.provision.mock.calls[0][0]).toMatchObject({ p_teacher: "t1", p_class: CLASS, p_consent_ref: "Class consent forms, term 1" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("refuses anyone not signed in, bad names, a missing consent confirmation and another teacher's class", async () => {
    state.user = null; expect((await call("", good)).status).toBe(401); state.user = { id: "t1" };
    expect((await call("", { ...good, names: ["Ama", "<script>"] })).status).toBe(400);
    expect((await call("", { ...good, names: [] })).status).toBe(400);
    expect((await call("", { ...good, consentConfirmed: false })).status).toBe(400);
    expect((await call("", { ...good, consentReference: "no" })).status).toBe(400);
    expect((await call("", { ...good, classId: "not-a-uuid" })).status).toBe(400);
    state.ctxError = true; expect((await call("", good)).status).toBe(403);
    expect(state.createUser).not.toHaveBeenCalled();
  });
  it("applies the hourly limit before creating anything", async () => {
    state.budget = false; const res = await call("", good);
    expect(res.status).toBe(429); expect(state.createUser).not.toHaveBeenCalled();
  });
  it("removes the sign-in again if the account could not be completed, and says which name failed", async () => {
    state.provision = vi.fn(async (a: any) => a.p_first_name === "Kofi" ? { data: null, error: { message: "boom" } } : { data: {}, error: null });
    const out = await (await call("", good)).json();
    expect(out.created.map((c: any) => c.first_name)).toEqual(["Ama"]);
    expect(out.failed).toEqual([{ name: "Kofi", reason: "Could not finish setting up the account." }]);
    expect(state.deleteUser).toHaveBeenCalledTimes(1);
  });
  it("tries another username if one is taken", async () => {
    let n = 0; state.createUser = vi.fn(async () => (++n === 1 ? { data: { user: null }, error: { message: "User already registered" } } : { data: { user: { id: "u" + n } }, error: null }));
    const out = await (await call("", { ...good, names: ["Ama"] })).json();
    expect(out.created).toHaveLength(1); expect(state.createUser).toHaveBeenCalledTimes(2);
  });
});

describe("reset and archive routes", () => {
  beforeEach(() => { Object.assign(state, { user: { id: "t1" }, authorise: true, archive: { error: null }, budget: true }); state.updateUser = vi.fn(async () => ({ error: null })); });
  it("resets a managed learner's password for their own teacher only, and returns it once", async () => {
    const res = await call("/reset", { learnerId: LEARNER }); const out = await res.json();
    expect(res.status).toBe(200); expect(out.password).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(state.updateUser).toHaveBeenCalledWith(LEARNER, { password: out.password });
    state.authorise = false; expect((await call("/reset", { learnerId: LEARNER })).status).toBe(403);
    state.user = null; expect((await call("/reset", { learnerId: LEARNER })).status).toBe(401);
    state.user = { id: "t1" }; expect((await call("/reset", { learnerId: "x" })).status).toBe(400);
  });
  it("ends an account in the database and blocks sign-in", async () => {
    expect((await call("/archive", { learnerId: LEARNER })).status).toBe(200);
    expect(state.updateUser).toHaveBeenCalledWith(LEARNER, { ban_duration: "876000h" });
    state.updateUser.mockClear(); state.archive = { error: { message: "QB_MANAGED_LEARNER_NOT_FOUND" } };
    expect((await call("/archive", { learnerId: LEARNER })).status).toBe(403);
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});
