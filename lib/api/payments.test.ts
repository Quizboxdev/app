import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }) }));
import { startCheckout } from "./payments";

afterEach(() => vi.unstubAllGlobals());

describe("startCheckout", () => {
  it("keeps the server's support code on the error so the screen can show it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, code: "NO_PROVIDER_KEY", error: "Online payment is not open yet." }), { status: 503 })));
    await expect(startCheckout("weekly")).rejects.toMatchObject({ message: "Online payment is not open yet.", code: "NO_PROVIDER_KEY" });
  });
  it("returns the payment address on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, url: "https://checkout.paystack.com/abc" }), { status: 200 })));
    expect(await startCheckout("weekly")).toEqual({ url: "https://checkout.paystack.com/abc" });
  });
});
