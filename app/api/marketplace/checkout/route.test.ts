import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Marketplace checkout: priced from the database, the cart recorded on the payment and sent to Paystack as metadata, and every refusal explained.
const admin = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc: admin }) }));
const userRpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1", email: "buyer@example.com" } }, error: null }) }, rpc: userRpc }) }));
import { POST } from "./route";

const ITEM = "11111111-1111-4111-8111-111111111111";
const CART = { item_id: ITEM, title: "Chem Mock Exam", subject: "Chemistry", school: "Opoku Ware School", grade: "SHS1", seller: "Ama Mensah", seller_id: "s1", price_minor: 2000 };
const request = (body: unknown = { itemId: ITEM }, auth = true) => new Request("https://www.quizbox.io/api/marketplace/checkout", { method: "POST", headers: { ...(auth ? { authorization: "Bearer t" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const happy = (over: Record<string, unknown> = {}) => userRpc.mockImplementation(async (fn: string) => {
  if (fn === "qb_mk_prepare_purchase") return { data: { ...CART, ...over }, error: null };
  if (fn === "qb_subscription_catalog") return { data: { unit_price_minor: 100 }, error: null };
  if (fn === "qb_payment_intent_create") return { data: { reference: "QB-abc", amount_minor: Number((over.price_minor as number) ?? 2000) }, error: null };
  return { data: null, error: null };
});
beforeEach(() => { vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_marker_secret_9"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"); vi.spyOn(console, "error").mockImplementation(() => undefined); admin.mockResolvedValue({ data: null, error: null }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); userRpc.mockReset(); admin.mockReset(); });

describe("POST /api/marketplace/checkout", () => {
  it("needs a signed-in caller, a configured gateway and a real set id", async () => {
    expect((await POST(request({ itemId: ITEM }, false))).status).toBe(401);
    for (const itemId of ["", "abc", 5, null, "11111111-1111-4111-8111-11111111111g"]) expect((await POST(request({ itemId }))).status).toBe(400);
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(await (await POST(request())).json()).toMatchObject({ code: "NO_PROVIDER_KEY" });
  });

  it("explains why a set cannot be bought: your own, already owned, a child, not on sale", async () => {
    const cases: [string, number, RegExp][] = [["QB_OWN_ITEM", 403, /your own/], ["QB_ALREADY_OWNED", 403, /already have/], ["QB_MINOR_CANNOT_PAY", 403, /teacher or a parent/], ["QB_NOT_FOUND", 404, /not on sale/]];
    for (const [code, status, text] of cases) {
      userRpc.mockResolvedValue({ data: null, error: { message: `${code} something` } });
      const res = await POST(request());
      expect(res.status, code).toBe(status);
      expect(await res.json()).toMatchObject({ ok: false, code, error: expect.stringMatching(text) });
    }
  });

  it("prices the cart from the database, records it on the payment, and sends it to Paystack with its source", async () => {
    happy();
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/xyz", reference: "QB-abc" } }), { status: 200 }); }));
    const res = await POST(request({ itemId: ITEM, price_minor: 1, amount: 1 }));                     // a price from the browser is ignored
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, url: "https://checkout.paystack.com/xyz", reference: "QB-abc" });
    expect(userRpc).toHaveBeenCalledWith("qb_payment_intent_create", expect.objectContaining({ p_coins: 20, p_beneficiary: "u1" }));
    expect(userRpc.mock.calls.find((c) => c[0] === "qb_payment_intent_create")![1].p_idem).toMatch(/^mk-11111111-1111-4111-8111-111111111111-\d+$/);
    expect(admin).toHaveBeenCalledWith("qb_mk_set_payment_item", { p_reference: "QB-abc", p_item: ITEM, p_price_minor: 2000 });
    expect(sent[0]).toMatchObject({ amount: 2000, currency: "GHS", reference: "QB-abc", email: "buyer@example.com" });
    expect(sent[0].callback_url).toMatch(/^https:\/\/(www\.)?quizbox\.io\/marketplace\/mine\?reference=QB-abc$/);
    expect(sent[0].metadata).toMatchObject({ purpose: "marketplace", item_id: ITEM, item_title: "Chem Mock Exam", subject: "Chemistry", school: "Opoku Ware School", grade: "SHS1", seller: "Ama Mensah", price_minor: 2000 });
    expect(sent[0].metadata.custom_fields.map((f: any) => f.value)).toEqual(["Chem Mock Exam", "Chemistry · Opoku Ware School", "SHS1", "Ama Mensah"]);
  });

  it("refuses when the database price and the payment amount disagree, or the price is not whole Coins, and never leaks the key", async () => {
    userRpc.mockImplementation(async (fn: string) => fn === "qb_mk_prepare_purchase" ? { data: CART, error: null } : fn === "qb_subscription_catalog" ? { data: { unit_price_minor: 100 }, error: null } : { data: { reference: "QB-abc", amount_minor: 1900 }, error: null });
    const res = await POST(request());
    expect(res.status).toBe(500); expect(await res.json()).toMatchObject({ code: "PRICE_MISMATCH" });
    happy({ price_minor: 2050 });
    expect(await (await POST(request())).json()).toMatchObject({ code: "PRICE_NOT_WHOLE_COINS" });
    happy({ price_minor: 400 });
    expect(await (await POST(request())).json()).toMatchObject({ code: "PRICE_NOT_WHOLE_COINS" });
    expect(admin).not.toHaveBeenCalled();
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain("marker_secret");
  });

  it("stops if the cart cannot be recorded or the gateway is down", async () => {
    happy(); admin.mockResolvedValue({ data: null, error: { message: "QB_PRICE_CHANGED" } });
    expect(await (await POST(request())).json()).toMatchObject({ code: "CART_NOT_RECORDED" });
    admin.mockResolvedValue({ data: null, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const res = await POST(request());
    expect(res.status).toBe(502); expect(await res.json()).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
