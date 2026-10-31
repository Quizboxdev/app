import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-level security tests with a fake database: nothing here talks to Supabase.
const state = vi.hoisted(() => ({ handlers: {} as Record<string, any>, calls: [] as { fn: string; args: any }[], created: [] as any[], links: [] as any[], profileEmail: "kofi@school.example" }));
vi.mock("@/lib/supabase/server-admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: async (fn: string, args: any) => {
      state.calls.push({ fn, args });
      const h = state.handlers[fn];
      const r = h ? h(args) : fn === "qb_partner_rate_check" ? { data: true } : { data: null };
      return { data: r.data ?? null, error: r.error ?? null };
    },
    auth: { admin: {
      createUser: async (u: any) => { state.created.push(u); return { data: { user: { id: "new-user" } }, error: null }; },
      generateLink: async (l: any) => { state.links.push(l); return { data: { properties: { action_link: "https://supabase.example/verify?token=abc" } }, error: null }; },
    } },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { email: state.profileEmail } }) }) }) }),
  }),
}));

const KEY = randomBytes(32);
process.env.PARTNER_SECRETS_KEY = KEY.toString("base64");
process.env.PARTNER_SSO_ORIGIN = "https://www.quizbox.io";
import { decryptSecret, encryptSecret, signWebhook } from "./crypto";
import { finishSignIn, startSignIn } from "./sso";
import { clearJwksCache } from "./oidc";
import { GET as licences } from "@/app/api/partner/v1/licences/route";
import { GET as seatsGet, POST as seatsPost } from "@/app/api/partner/v1/seats/route";
import { DELETE as seatsDelete } from "@/app/api/partner/v1/seats/[ref]/route";
import { GET as memberGet } from "@/app/api/partner/v1/members/[ref]/route";
import { GET as health } from "@/app/api/partner/v1/health/route";
import { POST as events } from "@/app/api/partner/v1/events/route";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";

const PID = "11111111-1111-4111-8111-111111111111", CID = "22222222-2222-4222-8222-222222222222";
const SECRET = "qbpk_" + "a".repeat(64);
const asKey = (scopes: string[]) => ({ qb_partner_credential_verify: () => ({ data: { partner_id: PID, credential_id: "cred", scopes } }) });
const req = (url: string, init: RequestInit = {}) => new Request(`https://www.quizbox.io${url}`, init);
const authed = (init: RequestInit = {}) => ({ ...init, headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json", ...(init.headers as object) } });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
beforeEach(() => { state.handlers = {}; state.calls = []; state.created = []; state.links = []; });

describe("partner API authentication", () => {
  it("refuses a missing, malformed or unknown key with the same answer", async () => {
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer nope" }, { authorization: "Basic abc" }, { authorization: `Bearer qbpk_${"z".repeat(64)}` }]) {
      const r = await json(await licences(req("/api/partner/v1/licences", { headers })));
      expect(r.status).toBe(401); expect(r.body.error.code).toBe("AUTH_INVALID");
    }
    state.handlers.qb_partner_credential_verify = () => ({ error: { message: "QB_PARTNER_AUTH_INVALID" } });
    expect((await json(await licences(req("/api/partner/v1/licences", authed())))).body.error.code).toBe("AUTH_INVALID");
  });
  it("refuses a key without the scope, and a throttled caller", async () => {
    state.handlers = asKey(["seats:read"]);
    expect((await json(await licences(req("/api/partner/v1/licences", authed())))).body.error.code).toBe("SCOPE_FORBIDDEN");
    state.handlers = { ...asKey(["licence:read"]), qb_partner_rate_check: () => ({ data: false }) };
    const r = await licences(req("/api/partner/v1/licences", authed()));
    expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBe("60");
  });
  it("fails closed when the limiter itself is unavailable", async () => {
    state.handlers = { ...asKey(["licence:read"]), qb_partner_rate_check: () => ({ error: { message: "db down" } }) };
    expect((await licences(req("/api/partner/v1/licences", authed()))).status).toBe(500);
  });
  it("is bound to the key's own partner: the partner id sent to the database comes from the key, never from the request", async () => {
    state.handlers = { ...asKey(["licence:read", "seats:read", "seats:write", "members:read", "health:read"]), qb_partner_licence_status: () => ({ data: [{ contract_id: CID }] }), qb_partner_seat_list: () => ({ data: [] }),
      qb_partner_member_lookup: () => ({ data: [{ kind: "learner" }] }), qb_partner_health: () => ({ data: { ok: true } }), qb_partner_seat_revoke: () => ({ data: { revoked: 1 } }) };
    await licences(req("/api/partner/v1/licences?partner_id=evil", authed()));
    await seatsGet(req(`/api/partner/v1/seats?contract_id=${CID}&partner_id=evil`, authed()));
    await memberGet(req("/api/partner/v1/members/abc", authed()), { params: Promise.resolve({ ref: "abc" }) });
    await health(req("/api/partner/v1/health", authed()));
    await seatsDelete(req("/api/partner/v1/seats/abc?partner=evil", authed({ method: "DELETE" })), { params: Promise.resolve({ ref: "abc" }) });
    const used = state.calls.filter((c) => c.fn.startsWith("qb_partner_") && !["qb_partner_rate_check", "qb_partner_credential_verify"].includes(c.fn));
    expect(used.length).toBe(5);
    expect(used.every((c) => c.args.p_partner === PID)).toBe(true);
  });
});

describe("partner API behaviour", () => {
  beforeEach(() => { state.handlers = asKey(["seats:read", "seats:write", "members:read"]); });
  it("validates seat requests and reports a duplicate as 200, a new seat as 201, a full contract as 409", async () => {
    const post = (body: unknown) => seatsPost(req("/api/partner/v1/seats", authed({ method: "POST", body: JSON.stringify(body) })));
    expect((await post({ contract_id: "bad", external_ref: "x" })).status).toBe(400);
    expect((await post({ contract_id: CID, external_ref: "" })).status).toBe(400);
    expect((await post({ contract_id: CID, external_ref: "x", kind: "principal" })).status).toBe(400);
    state.handlers.qb_partner_seat_allocate = () => ({ data: { seat_id: "s", duplicate: false } });
    expect((await post({ contract_id: CID, external_ref: "x" })).status).toBe(201);
    state.handlers.qb_partner_seat_allocate = () => ({ data: { seat_id: "s", duplicate: true } });
    expect((await post({ contract_id: CID, external_ref: "x" })).status).toBe(200);
    state.handlers.qb_partner_seat_allocate = () => ({ error: { message: "QB_PARTNER_SEAT_CAPACITY" } });
    const full = await json(await post({ contract_id: CID, external_ref: "x" }));
    expect(full.status).toBe(409); expect(full.body.error.code).toBe("SEAT_CAPACITY_EXCEEDED");
    state.handlers.qb_partner_seat_allocate = () => ({ error: { message: "QB_PARTNER_LICENCE_NOT_ACTIVE" } });
    expect((await json(await post({ contract_id: CID, external_ref: "x" }))).body.error.code).toBe("LICENCE_NOT_ACTIVE");
  });
  it("rejects non-JSON, oversize and non-object bodies", async () => {
    expect((await seatsPost(req("/api/partner/v1/seats", authed({ method: "POST", body: "x", headers: { "content-type": "text/plain" } })))).status).toBe(415);
    expect((await seatsPost(req("/api/partner/v1/seats", authed({ method: "POST", body: JSON.stringify({ a: "x".repeat(5000) }) })))).status).toBe(413);
    expect((await seatsPost(req("/api/partner/v1/seats", authed({ method: "POST", body: "[1]" })))).status).toBe(400);
    expect((await seatsPost(req("/api/partner/v1/seats", authed({ method: "POST", body: "{bad" })))).status).toBe(400);
  });
  it("lists with bounded paging and returns 404 for an unknown member", async () => {
    expect((await seatsGet(req(`/api/partner/v1/seats?contract_id=${CID}&limit=9999`, authed()))).status).toBe(400);
    expect((await seatsGet(req("/api/partner/v1/seats", authed()))).status).toBe(400);
    state.handlers.qb_partner_member_lookup = () => ({ data: [] });
    expect((await memberGet(req("/api/partner/v1/members/nobody", authed()), { params: Promise.resolve({ ref: "nobody" }) })).status).toBe(404);
  });
});

describe("signed events", () => {
  const secretEnc = encryptSecret("whsec_test", KEY);
  const evt = (over: object = {}) => ({ id: "evt-1", type: "partner.seat.allocated", data: { contract_id: CID, external_ref: "m-1" }, ...over });
  const send = (body: string, sigSecret = "whsec_test", over: { t?: number; headers?: Record<string, string> } = {}) =>
    events(req("/api/partner/v1/events", { method: "POST", body, headers: { "content-type": "application/json", "x-quizbox-partner": PID, "x-quizbox-signature": signWebhook(sigSecret, body, over.t), ...over.headers } }));
  beforeEach(() => {
    state.handlers = { qb_partner_webhook_secrets_active: () => ({ data: [secretEnc] }), qb_partner_event_begin: () => ({ data: { state: "new" } }), qb_partner_event_finish: () => ({ data: { status: "processed" } }), qb_partner_seat_allocate: () => ({ data: { seat_id: "s" } }) };
  });
  it("processes a correctly signed event once and answers a duplicate without acting", async () => {
    const body = JSON.stringify(evt());
    expect(await json(await send(body))).toEqual({ status: 200, body: { status: "processed", event_id: "evt-1" } });
    expect(state.calls.some((c) => c.fn === "qb_partner_seat_allocate" && c.args.p_partner === PID)).toBe(true);
    state.calls = []; state.handlers.qb_partner_event_begin = () => ({ data: { state: "duplicate", status: "processed" } });
    expect((await json(await send(body))).body.status).toBe("duplicate");
    expect(state.calls.some((c) => c.fn === "qb_partner_seat_allocate")).toBe(false);
  });
  it("changes nothing for a missing, wrong, stale or future signature, or a signature for another body", async () => {
    const body = JSON.stringify(evt());
    const now = Math.floor(Date.now() / 1000);
    const bad = [await send(body, "wrong-secret"), await send(body, "whsec_test", { t: now - 1000 }), await send(body, "whsec_test", { t: now + 1000 }),
      await send(body, "whsec_test", { headers: { "x-quizbox-signature": signWebhook("whsec_test", body + "x") } }), await send(body, "whsec_test", { headers: { "x-quizbox-signature": "" } }),
      await send(body, "whsec_test", { headers: { "x-quizbox-partner": "not-a-uuid" } })];
    for (const r of bad) { expect(r.status).toBe(401); expect((await r.json()).error.code).toBe("SIGNATURE_INVALID"); }
    expect(state.calls.some((c) => ["qb_partner_event_begin", "qb_partner_seat_allocate"].includes(c.fn))).toBe(false);
  });
  it("skips an unreadable stored secret and an unknown partner looks the same as a bad signature", async () => {
    state.handlers.qb_partner_webhook_secrets_active = () => ({ data: ["v1:garbage.garbage.garbage", secretEnc] });
    expect((await send(JSON.stringify(evt()))).status).toBe(200);
    state.handlers.qb_partner_webhook_secrets_active = () => ({ error: { message: "QB_PARTNER_AUTH_INVALID" } });
    expect((await json(await send(JSON.stringify(evt())))).body.error.code).toBe("SIGNATURE_INVALID");
  });
  it("enforces size, content type, schema and the supported event list (after the signature)", async () => {
    expect((await send(JSON.stringify(evt({ data: { pad: "x".repeat(17000) } })))).status).toBe(413);
    expect((await events(req("/api/partner/v1/events", { method: "POST", body: "x", headers: { "content-type": "text/plain", "x-quizbox-partner": PID } }))).status).toBe(415);
    expect((await json(await send(JSON.stringify(evt({ type: "partner.contract.capacity_increased", data: { seats: 99999 } }))))).body.error.code).toBe("EVENT_UNSUPPORTED");
    expect((await json(await send(JSON.stringify(evt({ data: { contract_id: "nope", external_ref: "a" } }))))).body.error.code).toBe("INVALID_REQUEST");
    expect((await json(await send("[1]"))).body.error.code).toBe("INVALID_REQUEST");
    expect((await json(await send("{not json"))).body.error.code).toBe("INVALID_REQUEST");
  });
  it("a replay of an event id with a different body is refused, and a capacity refusal is recorded as failed", async () => {
    state.handlers.qb_partner_event_begin = () => ({ error: { message: "QB_PARTNER_EVENT_REPLAY_MISMATCH" } });
    expect((await json(await send(JSON.stringify(evt())))).body.error.code).toBe("EVENT_REPLAY_MISMATCH");
    state.handlers.qb_partner_event_begin = () => ({ data: { state: "new" } });
    state.handlers.qb_partner_seat_allocate = () => ({ error: { message: "QB_PARTNER_SEAT_CAPACITY" } });
    const r = await json(await send(JSON.stringify(evt())));
    expect(r.status).toBe(409); expect(r.body.error.code).toBe("SEAT_CAPACITY_EXCEEDED");
    expect(state.calls.find((c) => c.fn === "qb_partner_event_finish")?.args).toMatchObject({ p_ok: false, p_error: "SEAT_CAPACITY_EXCEEDED" });
  });
  it("an unexpected failure is answered 500 so the partner retries, and revocation and reference events call only their own functions", async () => {
    state.handlers.qb_partner_seat_allocate = () => ({ error: { message: "connection reset" } });
    expect((await json(await send(JSON.stringify(evt())))).body.error.code).toBe("EVENT_PROCESSING_FAILED");
    state.handlers.qb_partner_seat_revoke = () => ({ data: { revoked: 1 } }); state.handlers.qb_partner_contract_reference_update = () => ({ data: { ok: true } });
    state.calls = [];
    await send(JSON.stringify({ id: "e2", type: "partner.seat.revoked", data: { external_ref: "m-1" } }));
    await send(JSON.stringify({ id: "e3", type: "partner.contract.reference_updated", data: { contract_id: CID, billing_reference: "INV-77" } }));
    const r = await json(await send(JSON.stringify({ id: "e4", type: "partner.member.updated", data: { external_ref: "m-1", active: true } })));
    expect(r.body.status).toBe("ignored");
    expect(state.calls.map((c) => c.fn).filter((f) => !f.includes("rate") && !f.includes("secrets") && !f.includes("event_"))).toEqual(["qb_partner_seat_revoke", "qb_partner_contract_reference_update"]);
  });
  it("the stored ciphertext is not the secret", () => { expect(secretEnc).not.toContain("whsec_test"); expect(decryptSecret(secretEnc, KEY)).toBe("whsec_test"); });
});

describe("partner sign-in", () => {
  const ISS = "https://idp.school.example", AUD = "client-1";
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwks = [{ ...rsa.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" }];
  const cfg = { partner_id: PID, name: "Test School", issuer: ISS, audience: AUD, jwks_uri: `${ISS}/jwks`, authorization_endpoint: `${ISS}/auth`, token_endpoint: `${ISS}/token`, client_secret_enc: encryptSecret("shh", KEY), allowed_domains: ["school.example"], auto_provision: false };
  const idToken = (c: object) => { const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url"), b = Buffer.from(JSON.stringify(c)).toString("base64url"); return `${h}.${b}.${createSign("RSA-SHA256").update(`${h}.${b}`).sign(rsa.privateKey).toString("base64url")}`; };
  const deps = (fetchBody: () => any) => ({ admin: getSupabaseAdminClient() as any, key: KEY, fetchImpl: (async () => new Response(JSON.stringify(fetchBody()), { status: 200 })) as any, fetchJwks: async () => jwks as any });
  const begin = async () => {
    const r = await startSignIn("test-school", req("/api/partner/v1/sso/test-school/start"), { admin: getSupabaseAdminClient() as any, key: KEY });
    const loc = new URL(r.headers.get("location")!), setCookie = r.headers.get("set-cookie")!;
    return { r, loc, cookie: setCookie.split(";")[0], state: loc.searchParams.get("state")!, nonce: loc.searchParams.get("nonce")! };
  };
  const callback = (cookie: string, params: Record<string, string>, d: any) => finishSignIn(req(`/api/partner/v1/sso/callback?${new URLSearchParams(params)}`, { headers: { cookie } }), d);
  const locOf = (r: Response) => r.headers.get("location")!;
  beforeEach(() => { clearJwksCache(); state.handlers = { qb_partner_oidc_config: () => ({ data: cfg }) }; });

  it("start sends the browser to the partner with code + PKCE + state + nonce and sets a signed HttpOnly cookie", async () => {
    const { r, loc } = await begin();
    expect(r.status).toBe(302); expect(loc.origin + loc.pathname).toBe(`${ISS}/auth`);
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256"); expect(loc.searchParams.get("redirect_uri")).toBe("https://www.quizbox.io/api/partner/v1/sso/callback");
    const c = r.headers.get("set-cookie")!; expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Lax/); expect(c).toMatch(/Secure/); expect(c).toMatch(/Max-Age=600/);
    state.handlers.qb_partner_oidc_config = () => ({ data: null });
    expect(locOf(await startSignIn("test-school", req("/x"), { admin: getSupabaseAdminClient() as any, key: KEY }))).toContain("error=PARTNER_SSO_UNAVAILABLE");
    expect(locOf(await startSignIn("Bad Slug!", req("/x"), { admin: getSupabaseAdminClient() as any, key: KEY }))).toContain("error=PARTNER_SSO_UNAVAILABLE");
  });
  it("completes sign-in for a linked account and hands over to a single-use QuizBox link, never a password", async () => {
    const { cookie, state: st, nonce } = await begin();
    state.handlers = { ...state.handlers, qb_partner_sso_find_account: () => ({ data: { user_id: "u1", via: "link" } }), qb_partner_sso_link: () => ({ data: { linked: true, seat: true, licensed: true } }) };
    const now = Math.floor(Date.now() / 1000);
    const d = deps(() => ({ id_token: idToken({ iss: ISS, aud: AUD, sub: "emp-1", exp: now + 300, iat: now, nonce, email: "kofi@school.example", email_verified: true }) }));
    const r = await callback(cookie, { code: "abc", state: st }, d);
    expect(locOf(r)).toBe("https://supabase.example/verify?token=abc");
    expect(state.links[0]).toMatchObject({ type: "magiclink", email: "kofi@school.example" });
    expect(state.calls.find((c) => c.fn === "qb_partner_sso_link")?.args).toMatchObject({ p_partner: PID, p_issuer: ISS, p_subject: "emp-1", p_external_ref: "emp-1", p_user: "u1" });
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
  it("refuses a state mismatch, a missing or tampered cookie, an expired cookie and an IdP error", async () => {
    const { cookie, state: st } = await begin();
    const d = deps(() => ({}));
    expect(locOf(await callback(cookie, { code: "abc", state: "other" }, d))).toContain("error=PARTNER_SSO_STATE_INVALID");
    expect(locOf(await callback("", { code: "abc", state: st }, d))).toContain("error=PARTNER_SSO_EXPIRED");
    expect(locOf(await callback(cookie.replace(/.$/, "x"), { code: "abc", state: st }, d))).toContain("error=PARTNER_SSO_EXPIRED");
    expect(locOf(await callback(cookie, { error: "access_denied", state: st }, d))).toContain("error=PARTNER_SSO_DENIED");
    expect(locOf(await callback(cookie, { code: "abc", state: st }, { ...d, nowSeconds: Math.floor(Date.now() / 1000) + 5000 }))).toContain("error=PARTNER_SSO_EXPIRED");
    expect(state.calls.some((c) => c.fn === "qb_partner_sso_link")).toBe(false);
  });
  // Changes one character in the middle of the signature. The last base64url character of a 256-byte signature carries unused padding bits, so replacing it can leave the decoded bytes unchanged.
  const flipSignatureChar = (token: string) => { const i = token.length - 20; return token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1); };
  it("refuses a forged token: wrong nonce, wrong audience, wrong issuer, bad signature", async () => {
    const { cookie, state: st, nonce } = await begin();
    const now = Math.floor(Date.now() / 1000), good = { iss: ISS, aud: AUD, sub: "x", exp: now + 300, iat: now, nonce };
    const attempt = async (c: object, tamper = false) => locOf(await callback(cookie, { code: "abc", state: st }, deps(() => ({ id_token: tamper ? flipSignatureChar(idToken(c)) : idToken(c) }))));
    expect(await attempt({ ...good, nonce: "replayed" })).toContain("OIDC_NONCE_MISMATCH");
    expect(await attempt({ ...good, aud: "other" })).toContain("OIDC_AUDIENCE_MISMATCH");
    expect(await attempt({ ...good, iss: "https://evil.example" })).toContain("OIDC_ISSUER_MISMATCH");
    expect(await attempt(good, true)).toContain("OIDC_SIGNATURE_INVALID");
    expect(state.calls.some((c) => c.fn === "qb_partner_sso_find_account")).toBe(false);
  });
  it("does not sign in a revoked member, an unknown person (no provisioning), or a conflicting identity", async () => {
    const { cookie, state: st, nonce } = await begin();
    const now = Math.floor(Date.now() / 1000), tok = () => ({ id_token: idToken({ iss: ISS, aud: AUD, sub: "emp-9", exp: now + 300, iat: now, nonce, email: "new@school.example", email_verified: true }) });
    state.handlers.qb_partner_sso_find_account = () => ({ data: { user_id: null, via: "revoked" } });
    expect(locOf(await callback(cookie, { code: "a", state: st }, deps(tok)))).toContain("PARTNER_MEMBER_REVOKED");
    state.handlers.qb_partner_sso_find_account = () => ({ data: { user_id: null, via: "none" } });
    expect(locOf(await callback(cookie, { code: "a", state: st }, deps(tok)))).toContain("PARTNER_ACCOUNT_NOT_FOUND");
    expect(state.created.length).toBe(0);
    state.handlers.qb_partner_sso_find_account = () => ({ data: { user_id: "u1", via: "link" } });
    state.handlers.qb_partner_sso_link = () => ({ error: { message: "QB_PARTNER_IDENTITY_CONFLICT" } });
    expect(locOf(await callback(cookie, { code: "a", state: st }, deps(tok)))).toContain("PARTNER_IDENTITY_CONFLICT");
    state.handlers.qb_partner_sso_link = () => ({ error: { message: "QB_PARTNER_MINOR_CONSENT_REQUIRED" } });
    expect(locOf(await callback(cookie, { code: "a", state: st }, deps(tok)))).toContain("PARTNER_MINOR_CONSENT_REQUIRED");
  });
  it("provisions a learner only when staff enabled it, the address is verified, in the approved domain, with a grade; never a staff role", async () => {
    state.handlers = { qb_partner_oidc_config: () => ({ data: { ...cfg, auto_provision: true } }), qb_partner_sso_find_account: () => ({ data: { user_id: null, via: "none" } }), qb_partner_sso_link: () => ({ data: { linked: true, seat: true } }) };
    const now = Math.floor(Date.now() / 1000);
    const run = async (extra: object) => { const { cookie, state: st, nonce } = await begin(); return locOf(await callback(cookie, { code: "a", state: st }, deps(() => ({ id_token: idToken({ iss: ISS, aud: AUD, sub: "emp-5", exp: now + 300, iat: now, nonce, ...extra }) })))); };
    expect(await run({ email: "kojo@school.example", email_verified: true })).toContain("PARTNER_ACCOUNT_NOT_FOUND");                 // no grade
    expect(await run({ email: "kojo@school.example", email_verified: false, grade: "JHS1" })).toContain("PARTNER_ACCOUNT_NOT_FOUND");   // not verified
    expect(await run({ email: "kojo@gmail.com", email_verified: true, grade: "JHS1" })).toContain("PARTNER_ACCOUNT_NOT_FOUND");         // outside the approved domain
    expect(state.created.length).toBe(0);
    state.profileEmail = "kojo@school.example";
    expect(await run({ email: "kojo@school.example", email_verified: true, grade: "JHS1", name: "Kojo", role: "admin", is_admin: true })).toBe("https://supabase.example/verify?token=abc");
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ email: "kojo@school.example", email_confirm: true, user_metadata: { grade: "JHS1", full_name: "Kojo" } });
    expect(JSON.stringify(state.created[0])).not.toMatch(/admin|role/i);                       // partner claims never become a QuizBox role
  });
});
