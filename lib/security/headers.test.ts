import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./headers";
import nextConfig from "../../next.config";

describe("security headers", () => {
  it("sends the baseline headers on every route", async () => {
    const routes = await nextConfig.headers!();
    const all = routes.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const keys = all!.headers.map((h) => h.key);
    for (const k of ["Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) expect(keys).toContain(k);
    expect(keys.some((k) => k.startsWith("Content-Security-Policy"))).toBe(true);
  });
  it("forbids framing, plugins and eval, and allows only Supabase as a data origin", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CONTENT_SECURITY_POLICY).toMatch(/connect-src 'self' https:\/\/\*\.supabase\.co/);
    expect(SECURITY_HEADERS.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
  });
});
