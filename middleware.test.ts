import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The middleware end to end with a stand-in for the sign-in service: off by default, turns signed-out visitors away when on, and never locks people out during an outage.
const getUser = vi.fn(); const created = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient: (...a: unknown[]) => { created(...a); return { auth: { getUser } }; } }));
import { middleware } from "./middleware";

const COOKIE = "sb-projref-auth-token=base64-abc";
const req = (path: string, opts: { cookie?: boolean; host?: string; prefetch?: boolean } = {}) => new NextRequest(`https://www.quizbox.io${path}`, { headers: { host: opts.host ?? "www.quizbox.io", ...(opts.cookie ? { cookie: COOKIE } : {}), ...(opts.prefetch ? { "next-router-prefetch": "1" } : {}) } });
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"); getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null }); });
afterEach(() => { vi.unstubAllEnvs(); getUser.mockReset(); created.mockReset(); });
const location = (r: Response) => r.headers.get("location");

describe("middleware", () => {
  it("does nothing to protected pages while the guard is off", async () => {
    const res = await middleware(req("/admin"));
    expect(res.status).toBe(200); expect(location(res)).toBeNull(); expect(getUser).not.toHaveBeenCalled();
  });
  it("still sends the challenge host to the main site, guard or no guard", async () => {
    const res = await middleware(req("/some-quiz", { host: "challenge.quizbox.io" }));
    expect(res.status).toBe(307); expect(location(res)).toBe("https://www.quizbox.io/challenges/some-quiz");
  });
  describe("with the guard on", () => {
    beforeEach(() => vi.stubEnv("QB_SERVER_GUARD", "on"));
    it("lets public pages and API routes through untouched, without asking the sign-in service", async () => {
      for (const p of ["/", "/login", "/pricing", "/help", "/challenges/x", "/api/payments/webhook/paystack", "/terms"]) { const res = await middleware(req(p)); expect(res.status, p).toBe(200); expect(location(res), p).toBeNull(); }
      expect(getUser).not.toHaveBeenCalled();
    });
    it("sends a signed-out request for a protected page to login, without calling the service, and remembers a quiz link", async () => {
      let res = await middleware(req("/admin")); expect(res.status).toBe(307); expect(location(res)).toBe("https://www.quizbox.io/login");
      res = await middleware(req("/play/some-quiz")); expect(location(res)).toBe("https://www.quizbox.io/login?next=%2Fplay%2Fsome-quiz");
      expect(getUser).not.toHaveBeenCalled();
    });
    it("lets a verified session through, and sends an expired or forged one to login", async () => {
      expect((await middleware(req("/teacher/classes", { cookie: true }))).status).toBe(200);
      getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthApiError", message: "invalid JWT" } });
      const res = await middleware(req("/teacher/classes", { cookie: true })); expect(res.status).toBe(307); expect(location(res)).toBe("https://www.quizbox.io/login");
    });
    it("fails open when the sign-in service cannot be reached or throws", async () => {
      getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", message: "fetch failed" } });
      expect((await middleware(req("/student", { cookie: true }))).status).toBe(200);
      getUser.mockRejectedValue(new Error("network down"));
      expect((await middleware(req("/student", { cookie: true }))).status).toBe(200);
    });
    it("does not verify background prefetches, but still turns away a prefetch with no session", async () => {
      expect((await middleware(req("/student", { cookie: true, prefetch: true }))).status).toBe(200); expect(getUser).not.toHaveBeenCalled();
      expect((await middleware(req("/student", { prefetch: true }))).status).toBe(307);
    });
  });
});
