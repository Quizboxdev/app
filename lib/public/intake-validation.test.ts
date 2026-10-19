import { describe, expect, it, vi, beforeEach } from "vitest";
import { toSubmission, validateSubmission } from "./intake-validation";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));

describe("intake validation", () => {
  it("maps each public form onto the one submission shape", () => {
    const sponsor = toSubmission("sponsor", { name: "Kofi", email: "k@x.com", phone: "0244000000", sponsor_type: "Company / CSR", organization: "Acme", country: "Ghana", intended_audience: "JHS", interest_summary: "Fund prizes" }, true);
    expect(sponsor).toMatchObject({ category: "SPONSOR", name: "Kofi", organization: "Acme", country_name: "Ghana", message: "Fund prizes", metadata: { sponsor_type: "Company / CSR", intended_audience: "JHS" } });
    const sme = toSubmission("sme", { full_name: "Ama Owusu", email: "a@x.com", country: "Ghana", subjects: "Science", education_levels: "JHS", professional_role: "Teacher", years_experience: "8", qualification_summary: "BEd Science" }, true);
    expect(sme).toMatchObject({ category: "SME", name: "Ama Owusu", subject: "Science", message: "BEd Science", metadata: { years_experience: "8" } });
    const school = toSubmission("school", { institution_name: "St Mary's", contact_person: "Head", email: "s@x.com", country: "Ghana", institution_type: "Private school", estimated_learners: "300", message: "" }, true);
    expect(school).toMatchObject({ category: "SCHOOL", name: "Head", organization: "St Mary's", message: "Interest from St Mary's" });
    const country = toSubmission("country", { name: "Yaw", email: "y@x.com", country: "Nigeria", role: "Teacher", curriculum: "WAEC SSCE" }, true);
    expect(country).toMatchObject({ category: "COUNTRY", message: "Curriculum or level: WAEC SSCE", metadata: { role: "Teacher", curriculum: "WAEC SSCE" } });
  });

  const ok = { category: "CONTACT", name: "Ama Mensah", email: " Ama@Example.COM ", message: " Hello ", consent: true, metadata: { enquiry_type: "General enquiry" } };
  it("accepts a clean submission and normalises it", () => {
    const r = validateSubmission(ok);
    expect(r).toEqual({ ok: true, value: { category: "CONTACT", name: "Ama Mensah", email: "ama@example.com", message: "Hello", metadata: { enquiry_type: "General enquiry" }, consent: true } });
  });
  it.each([
    ["no consent", { ...ok, consent: false }], ["unknown field", { ...ok, admin: true }], ["bad category", { ...ok, category: "ROOT" }], ["short name", { ...ok, name: "A" }],
    ["bad email", { ...ok, email: "nope" }], ["empty message", { ...ok, message: "  " }], ["long message", { ...ok, message: "x".repeat(2001) }], ["bad phone", { ...ok, phone: "abc" }],
    ["foreign metadata key", { ...ok, metadata: { role: "x" } }], ["non-text metadata", { ...ok, metadata: { enquiry_type: 5 } }], ["array", [ok]], ["null", null],
    ["long metadata", { ...ok, metadata: { enquiry_type: "x".repeat(301) } }], ["long country", { ...ok, country_name: "x".repeat(81) }],
  ])("rejects %s", (_n, input) => { expect(validateSubmission(input).ok).toBe(false); });
});

describe("intake route", () => {
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const { POST } = await import("../../app/api/public/intake/route");
    return POST(new Request("https://www.quizbox.io/api/public/intake", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", origin: "https://www.quizbox.io", host: "www.quizbox.io", "x-forwarded-for": "203.0.113.9", ...headers } }));
  };
  const form = { category: "CONTACT", name: "Ama Mensah", email: "ama@example.com", message: "Hello", consent: true, metadata: {}, website: "", elapsed_ms: 9000 };
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ error: null }); process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key"; });

  it("stores a good submission through the database function, with a hashed address and no raw IP", async () => {
    const res = await post(form);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("qb_submit_public_interest");
    expect(args.p_client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113.9");
    expect(args.p).not.toHaveProperty("website");
  });
  it("silently drops bots (filled honeypot or too fast) without storing anything", async () => {
    expect((await post({ ...form, website: "spam.example" })).status).toBe(202);
    expect((await post({ ...form, elapsed_ms: 400 })).status).toBe(202);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses other origins, wrong content types and oversized bodies", async () => {
    expect((await post(form, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(form, { origin: "" })).status).toBe(403);
    expect((await post(form, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ ...form, message: "x".repeat(9000) })).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("answers generically: validation 400, rate limit 429, server trouble 503", async () => {
    expect((await post({ ...form, email: "nope" })).status).toBe(400);
    rpc.mockResolvedValueOnce({ error: { message: "QB_RATE_LIMITED" } });
    expect((await post(form)).status).toBe(429);
    rpc.mockResolvedValueOnce({ error: { message: "connection refused" } });
    const res = await post(form); expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("connection refused");
  });
});
