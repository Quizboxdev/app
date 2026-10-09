import { describe, expect, it, vi } from "vitest";
import React from "react";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { initializePasswordRecovery, INVALID_RESET_MESSAGE, passwordChecks, PASSWORD_REQUIREMENTS, RECOVERY_FAILURE_MESSAGES, RecoveryLinkError, recoveryErrorMessage, recoveryFailureMessage, requestPasswordReset, RESET_PASSWORD_PATH, RESET_SUCCESS_MESSAGE, RESET_SUCCESS_PATH, validateResetPasswords } from "@/lib/auth-recovery";
import { RECOVERY_REDIRECT_SCRIPT } from "@/lib/recovery-redirect";

// Next preserves JSX; compile this one presentational component the same way dashboard-reference.test.ts does.
const PasswordUpdateForm = (() => {
  const compiled = ts.transpileModule(readFileSync("components/auth/PasswordUpdateForm.tsx", "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
  const mod = { exports: {} as { default: React.ComponentType<any> } };
  runInNewContext(compiled.outputText, { module: mod, exports: mod.exports, require: createRequire(import.meta.url) });
  return mod.exports.default;
})();
const storage = () => { const v = new Map<string, string>(); return { getItem: (k: string) => v.get(k) ?? null, setItem: (k: string, x: string) => { v.set(k, x); }, removeItem: (k: string) => { v.delete(k); } }; };
const b64 = (text: string) => Buffer.from(text).toString("base64url");

// Runs the exact inline script the layout ships, against a fake location and cookie jar.
function runRedirect(href: string, cookie = "") {
  const url = new URL(href), replace = vi.fn();
  const location = { pathname: url.pathname, search: url.search, hash: url.hash, replace };
  new Function("location", "document", "atob", RECOVERY_REDIRECT_SCRIPT)(location, { cookie }, (s: string) => Buffer.from(s, "base64").toString());
  return replace;
}
const verifierCookie = (value: string) => `sb-abc-auth-token-code-verifier=base64-${b64(value)}`;

describe("recovery redirect (Supabase falls back to the Site URL)", () => {
  it("forwards a PKCE recovery return that landed on the homepage, keeping the code", () => {
    const replace = runRedirect("https://quizbox.example/?code=abc123", `a=b; ${verifierCookie("verifier-123/PASSWORD_RECOVERY")}`);
    expect(replace).toHaveBeenCalledWith("/auth/update-password?code=abc123");
  });
  it("recognises the JSON-quoted '/recovery' verifier current auth-js writes", () => {
    const current = verifierCookie(JSON.stringify("verifier-123/recovery"));
    expect(runRedirect("https://quizbox.example/?code=abc123", current)).toHaveBeenCalledWith("/auth/update-password?code=abc123");
    expect(runRedirect("https://quizbox.example/auth/callback?code=abc123", current)).toHaveBeenCalledWith("/auth/update-password?code=abc123");
  });
  it("recognises the verifier the installed auth-js actually stores for resetPasswordForEmail", async () => {
    const { GoTrueClient } = await import("@supabase/auth-js");
    const jar = new Map<string, string>();
    const auth = new GoTrueClient({ url: "https://abc.supabase.example/auth/v1", storageKey: "sb-abc-auth-token", flowType: "pkce", autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
      storage: { getItem: (k: string) => jar.get(k) ?? null, setItem: (k: string, v: string) => { jar.set(k, v); }, removeItem: (k: string) => { jar.delete(k); } },
      fetch: (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch });
    await auth.resetPasswordForEmail("user@example.invalid", { redirectTo: "https://quizbox.example/auth/update-password" });
    const cookies = [...jar].filter(([k]) => k.endsWith("code-verifier")).map(([k, v]) => `${k}=base64-${b64(v)}`).join("; ");
    expect(runRedirect("https://quizbox.example/?code=abc", cookies)).toHaveBeenCalledWith("/auth/update-password?code=abc");
  });
  it("reads the per-flow verifier slot named by sb_flow_id", () => {
    const slot = `sb-abc-auth-token-flow-f1-code-verifier=base64-${b64(JSON.stringify("v/recovery"))}`;
    const fixed = verifierCookie(JSON.stringify("other"));
    expect(runRedirect("https://quizbox.example/?code=abc&sb_flow_id=f1", `${fixed}; ${slot}`)).toHaveBeenCalledWith("/auth/update-password?code=abc&sb_flow_id=f1");
    expect(runRedirect("https://quizbox.example/?code=abc&sb_flow_id=f2", `${fixed}; ${slot}`)).not.toHaveBeenCalled();
  });
  it("forwards implicit-style recovery links and keeps the hash", () => {
    expect(runRedirect("https://quizbox.example/login#access_token=t&type=recovery")).toHaveBeenCalledWith("/auth/update-password#access_token=t&type=recovery");
  });
  it("leaves ordinary sign-up or OAuth codes alone", () => {
    expect(runRedirect("https://quizbox.example/?code=abc", verifierCookie("verifier-123"))).not.toHaveBeenCalled();
    expect(runRedirect("https://quizbox.example/?code=abc", verifierCookie(JSON.stringify("verifier-123")))).not.toHaveBeenCalled();
    expect(runRedirect("https://quizbox.example/?code=abc")).not.toHaveBeenCalled();
  });
  it("never redirects from the recovery routes or without a code", () => {
    const cookie = verifierCookie("v/PASSWORD_RECOVERY");
    expect(runRedirect("https://quizbox.example/auth/update-password?code=abc", cookie)).not.toHaveBeenCalled();
    expect(runRedirect("https://quizbox.example/auth/reset-password?code=abc", cookie)).not.toHaveBeenCalled();
    expect(runRedirect("https://quizbox.example/", cookie)).not.toHaveBeenCalled();
  });
});

describe("password reset request", () => {
  it("asks Supabase to return to the dedicated update route on this origin", async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    await requestPasswordReset("user@example.invalid", "https://quizbox.example", { auth: { resetPasswordForEmail } } as never);
    expect(resetPasswordForEmail).toHaveBeenCalledWith("user@example.invalid", { redirectTo: "https://quizbox.example/auth/update-password" });
    expect(RESET_PASSWORD_PATH).toBe("/auth/update-password");
  });
  it("keeps the previous route as a client-side forwarder that never touches Supabase", () => {
    const source = readFileSync("app/auth/reset-password/page.tsx", "utf8");
    expect(source).toContain("RESET_PASSWORD_PATH + window.location.search + window.location.hash");
    expect(source).not.toMatch(/from "[^"]*supabase|initializePasswordRecovery|getSupabaseBrowserClient/);
  });
});

describe("recovery link failures", () => {
  const session = { user: { id: "u1" }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const client = (over: { initialize?: unknown; session?: unknown; event?: boolean } = {}) => ({ auth: {
    onAuthStateChange: vi.fn((cb: (e: string, s: unknown) => void) => { if (over.event) cb("PASSWORD_RECOVERY", session); return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    initialize: vi.fn().mockResolvedValue(over.initialize ?? { error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: over.session === undefined ? session : over.session }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: session.user }, error: null }),
  } }) as never;
  const reason = async (href: string, c: never) => {
    const url = new URL(href);
    try { await initializePasswordRecovery(url, storage(), () => url, c); } catch (e) { expect(e).toBeInstanceOf(RecoveryLinkError); expect((e as Error).message).toBe(INVALID_RESET_MESSAGE); return (e as RecoveryLinkError).reason; }
    return "none";
  };

  it("reports an expired link", async () => expect(await reason("https://x.invalid/auth/update-password#error=access_denied&error_code=otp_expired", client())).toBe("expired"));
  it("reports a link that was already used or opened in another browser", async () =>
    expect(await reason("https://x.invalid/auth/update-password?code=spent", client({ initialize: { error: Object.assign(new Error("invalid flow state, no valid flow state found"), { code: "flow_state_not_found" }) } }))).toBe("used"));
  it("reports a missing recovery session when the page is opened directly", async () =>
    expect(await reason("https://x.invalid/auth/update-password", client({ session: null }))).toBe("missing"));
  it("does not treat an already signed-in visit as a recovery", async () =>
    expect(await reason("https://x.invalid/auth/update-password", client({ event: false }))).toBe("missing"));
  it("reports a generic invalid link otherwise", async () =>
    expect(await reason("https://x.invalid/auth/update-password?error=server_error", client())).toBe("invalid"));
  it("accepts a valid recovery session", async () => {
    const url = new URL("https://x.invalid/auth/update-password?code=ok");
    expect(await initializePasswordRecovery(url, storage(), () => new URL("https://x.invalid/auth/update-password"), client({ event: true }))).toBe("u1");
  });
  it("gives each failure its own message and maps Supabase error codes", () => {
    expect(new Set(Object.values(RECOVERY_FAILURE_MESSAGES)).size).toBe(4);
    expect(recoveryFailureMessage(new RecoveryLinkError("expired"))).toBe(RECOVERY_FAILURE_MESSAGES.expired);
    expect(recoveryErrorMessage({ code: "otp_expired" })).toBe(RECOVERY_FAILURE_MESSAGES.expired);
    expect(recoveryErrorMessage({ code: "refresh_token_already_used" })).toBe(RECOVERY_FAILURE_MESSAGES.used);
    expect(recoveryErrorMessage({ code: "weak_password" })).toMatch(/too easy to guess/);
  });
});

describe("password update form", () => {
  const props = { requirements: PASSWORD_REQUIREMENTS, met: passwordChecks("", "") as readonly boolean[], password: "", confirmation: "", visible: false, busy: false, error: "", onPassword: () => {}, onConfirmation: () => {}, onToggleVisible: () => {}, onSubmit: () => {} };
  const html = (over: Partial<typeof props> = {}) => renderToStaticMarkup(React.createElement(PasswordUpdateForm, { ...props, ...over }));

  it("renders both fields, the visibility toggle, requirements and the submit button", () => {
    const markup = html();
    expect(markup).toContain("New password");
    expect(markup).toContain("Confirm new password");
    expect(markup).toContain("Show passwords");
    expect(markup).toContain("At least 6 characters");
    expect(markup).toContain("Not easy to guess");
    expect(markup).toContain("Both fields match");
    expect(markup).toContain("Update password");
    expect(markup.match(/type="password"/g)).toHaveLength(2);
  });
  it("shows the typed passwords when the toggle is on, and marks requirements as met", () => {
    const markup = html({ visible: true, password: "longenough1", confirmation: "longenough1", met: passwordChecks("longenough1", "longenough1") });
    expect(markup).not.toContain('type="password"');
    expect(markup.match(/data-met="true"/g)).toHaveLength(3);
    expect(passwordChecks("123456", "123456")).toEqual([true, false, true]);
  });
  it("surfaces a mismatch error and disables the form while updating", () => {
    expect(validateResetPasswords("longenough1", "longenough2")).toBe("Passwords do not match.");
    expect(html({ error: "Passwords do not match." })).toContain('role="alert"');
    expect(html({ busy: true })).toContain("disabled");
  });
  it("completes with a login redirect that carries the success message", () => {
    expect(RESET_SUCCESS_PATH).toBe("/login?password_reset=success");
    expect(RESET_SUCCESS_MESSAGE).toMatch(/Password updated successfully/);
  });
});
