import { describe, expect, it } from "vitest";
import { auditEnvironment, SUPABASE_PROJECTS } from "./environment-audit";
const jwt = (role: string, ref: string) => `x.${Buffer.from(JSON.stringify({ role, ref })).toString("base64url")}.x`;
const preview = { NEXT_PUBLIC_SUPABASE_URL: `https://${SUPABASE_PROJECTS.preview}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon", SUPABASE_PROJECTS.preview), SUPABASE_SERVICE_ROLE_KEY: jwt("service_role", SUPABASE_PROJECTS.preview), PAYSTACK_SECRET_KEY: "sk_test_fixture_only" };
describe("deployment environment consistency", () => {
  it("accepts an isolated Preview public/server pair with test payments", () => expect(auditEnvironment(preview, "preview").ok).toBe(true));
  it("rejects production database settings in Preview", () => expect(auditEnvironment(preview, "production").issues).toContain("SUPABASE_TARGET_PROJECT_MISMATCH"));
  it("rejects a live payment key in Preview", () => expect(auditEnvironment({ ...preview, PAYSTACK_SECRET_KEY: "sk_live_fixture_only" }, "preview").issues).toContain("NON_PRODUCTION_PAYMENT_KEY_MUST_BE_TEST"));
  it("rejects an anon key masquerading as the server service key", () => expect(auditEnvironment({ ...preview, SUPABASE_SERVICE_ROLE_KEY: preview.NEXT_PUBLIC_SUPABASE_ANON_KEY }, "preview").issues).toContain("SERVER_KEY_IS_NOT_SERVICE_ROLE"));
  it("rejects a server key from another project", () => expect(auditEnvironment({ ...preview, SUPABASE_SERVICE_ROLE_KEY: jwt("service_role", SUPABASE_PROJECTS.production) }, "preview").issues).toContain("SERVER_KEY_PROJECT_MISMATCH"));
  it("reports missing public configuration without printing supplied values", () => {
    const report = auditEnvironment({ PAYSTACK_SECRET_KEY: "sk_live_DO_NOT_PRINT", NEXT_PUBLIC_URL_SITE: "https://private.invalid" }, "preview");
    expect(report.issues).toContain("PUBLIC_SUPABASE_CONFIG_INVALID");
    expect(report.issues).toContain("MISSPELLED_SITE_URL_VARIABLE");
    expect(JSON.stringify(report)).not.toContain("DO_NOT_PRINT");
    expect(JSON.stringify(report)).not.toContain("private.invalid");
  });
  it("supports the existing publishable-key alias", () => expect(auditEnvironment({ NEXT_PUBLIC_SUPABASE_URL: preview.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" }, "preview").ok).toBe(true));
  it("allows test payments on the Production hostname during development", () => {
    const production = { ...preview, NEXT_PUBLIC_SUPABASE_URL: `https://${SUPABASE_PROJECTS.production}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon", SUPABASE_PROJECTS.production), SUPABASE_SERVICE_ROLE_KEY: jwt("service_role", SUPABASE_PROJECTS.production) };
    expect(auditEnvironment(production, "production").ok).toBe(true);
    expect(auditEnvironment(production, "production", false, "live").issues).toContain("PRODUCTION_PAYMENT_MODE_MISMATCH");
  });
  it("an explicit live mode never permits live payments in Preview", () => expect(auditEnvironment({ ...preview, PAYSTACK_SECRET_KEY: "sk_live_fixture_only" }, "preview", false, "live").issues).toContain("NON_PRODUCTION_PAYMENT_KEY_MUST_BE_TEST"));
  it("makes missing operational integrations explicit when requested", () => expect(auditEnvironment({}, "preview", true).issues).toEqual(expect.arrayContaining(["SERVER_KEY_MISSING", "PAYMENT_KEY_MISSING", "RESEND_API_KEY_MISSING"])));
});
