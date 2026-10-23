import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guardDecision, hasAuthCookie, isProtectedPath, PROTECTED_PREFIXES, serverGuardOn } from "./guard";

describe("server-side guard rules", () => {
  it("covers every section inside app/(app), so a new section cannot be left open by mistake", () => {
    const dirs = readdirSync(fileURLToPath(new URL("../../app/(app)", import.meta.url)), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect([...PROTECTED_PREFIXES].sort()).toEqual(dirs);
  });
  it("protects signed-in pages and nothing public", () => {
    for (const p of ["/admin", "/admin/exports", "/seller/items/new", "/marketplace/mine", "/play/some-quiz", "/student", "/teacher/classes"]) expect(isProtectedPath(p), p).toBe(true);
    for (const p of ["/", "/login", "/pricing", "/help", "/help/some-guide", "/challenges", "/challenges/some-quiz", "/competitions", "/terms", "/privacy", "/contact", "/join/abc", "/api/payments/webhook/paystack", "/auth/callback", "/onboarding", "/_next/static/x.js", "/administrator"]) expect(isProtectedPath(p), p).toBe(false);
  });
  it("is off unless QB_SERVER_GUARD is exactly 'on'", () => {
    expect(serverGuardOn({ QB_SERVER_GUARD: "on" })).toBe(true);
    for (const v of [undefined, "", "off", "ON", "true", "1"]) expect(serverGuardOn({ QB_SERVER_GUARD: v }), String(v)).toBe(false);
  });
  it("recognises the sign-in cookie, including a long one split in pieces", () => {
    expect(hasAuthCookie(["sb-abcdefg-auth-token"])).toBe(true);
    expect(hasAuthCookie(["theme", "sb-abcdefg-auth-token.0", "sb-abcdefg-auth-token.1"])).toBe(true);
    expect(hasAuthCookie(["sb-abcdefg-auth-token-code-verifier", "theme", "qb-next"])).toBe(false);
    expect(hasAuthCookie([])).toBe(false);
  });
  it("sends a signed-out request to login, an invalid session to login, and lets a valid or unverifiable one through", () => {
    expect(guardDecision({ hasCookie: false, prefetch: false, verdict: null })).toBe("login");
    expect(guardDecision({ hasCookie: false, prefetch: true, verdict: null })).toBe("login");
    expect(guardDecision({ hasCookie: true, prefetch: false, verdict: "invalid" })).toBe("login");
    expect(guardDecision({ hasCookie: true, prefetch: false, verdict: "valid" })).toBe("allow");
    expect(guardDecision({ hasCookie: true, prefetch: false, verdict: "unreachable" })).toBe("allow");     // an outage must not lock everyone out
    expect(guardDecision({ hasCookie: true, prefetch: true, verdict: null })).toBe("allow");
  });
});
