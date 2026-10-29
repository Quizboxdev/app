import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS, contentSecurityPolicy, cspMode, securityHeaders } from "./headers";
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
  it("asks browsers to report violations to our own collector", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("report-uri /api/ops/csp-report");
  });
  describe("Content-Security-Policy mode (set by the QB_CSP_MODE variable, no code edit)", () => {
    it("is report-only unless the variable is exactly 'enforce'", () => {
      expect(cspMode({})).toBe("report-only");
      for (const v of ["", "report-only", "ENFORCE", "true", "1", " enforce", "enforce "]) expect(cspMode({ QB_CSP_MODE: v }), JSON.stringify(v)).toBe("report-only");
      expect(cspMode({ QB_CSP_MODE: "enforce" })).toBe("enforce");
    });
    it("report-only uses the reporting header and does not upgrade requests", () => {
      const h = securityHeaders("report-only").map((x) => x.key);
      expect(h).toContain("Content-Security-Policy-Report-Only");
      expect(h).not.toContain("Content-Security-Policy");
      expect(contentSecurityPolicy("report-only")).not.toContain("upgrade-insecure-requests");
    });
    it("enforce uses the blocking header, upgrades requests, and keeps every other directive identical", () => {
      const h = securityHeaders("enforce").map((x) => x.key);
      expect(h).toContain("Content-Security-Policy");
      expect(h).not.toContain("Content-Security-Policy-Report-Only");
      const enforced = contentSecurityPolicy("enforce"), reporting = contentSecurityPolicy("report-only");
      expect(enforced).toContain("upgrade-insecure-requests");
      expect(enforced.replace("; upgrade-insecure-requests", "")).toBe(reporting);
    });
    it("the live module reads the mode from the environment of this test run (report-only unless set)", () => {
      expect(SECURITY_HEADERS.some((x) => x.key === "Content-Security-Policy-Report-Only")).toBe(process.env.QB_CSP_MODE !== "enforce");
    });
  });
});
