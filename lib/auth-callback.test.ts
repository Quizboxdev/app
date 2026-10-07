import { describe, expect, it, vi } from "vitest";
import { authErrorMessage, NETWORK_MESSAGE } from "@/lib/auth-errors";
import { authCallbackHref, hasAuthLinkParams } from "@/lib/auth-links";
import { completeAuthCallback, RECOVERY_STORAGE_KEY, RecoveryLinkError } from "@/lib/auth-recovery";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const session = { user: { id: "u1" }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
const client = ({ event, sess = session, initError = null, otpError = null }: { event?: string; sess?: unknown; initError?: unknown; otpError?: unknown } = {}) => ({
  auth: {
    onAuthStateChange: vi.fn((cb: (e: string, s: unknown) => void) => { if (event) cb(event, sess); return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    initialize: vi.fn().mockResolvedValue({ error: initError }),
    verifyOtp: vi.fn().mockResolvedValue({ error: otpError }),
    getSession: vi.fn().mockResolvedValue({ data: { session: sess }, error: null }),
  },
}) as never;

describe("auth error messages are never the opaque generic sentence", () => {
  it.each([
    [{ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }, "The email or password is incorrect."],
    [{ code: "email_not_confirmed", message: "Email not confirmed", status: 400 }, "Verify your email first"],
    [{ code: "over_request_rate_limit", message: "Request rate limit reached", status: 429 }, "Too many attempts"],
    [{ code: "user_banned", message: "User is banned", status: 400 }, "suspended"],
    [{ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }, NETWORK_MESSAGE],
    [new TypeError("Failed to fetch"), NETWORK_MESSAGE],
    [{ message: "Request rate limit reached" }, "Too many attempts"],
  ])("%o", (error, expected) => { expect(authErrorMessage(error)).toContain(expected); });
  it("an unknown failure carries a reference instead of the generic text", () => {
    const text = authErrorMessage({ code: "unexpected_failure", message: "Database error querying schema", status: 500 });
    expect(text).toContain("HTTP 500");
    expect(text).toContain("unexpected_failure");
    expect(text).not.toContain("The operation could not be completed");
  });
});

describe("email links that land on / or /login are completed by /auth/callback", () => {
  it("detects link parameters and preserves them", () => {
    expect(hasAuthLinkParams({ code: "abc" })).toBe(true);
    expect(hasAuthLinkParams({ error_code: "otp_expired", error_description: "x" })).toBe(true);
    expect(hasAuthLinkParams({ mode: "register", password_reset: "success" })).toBe(false);
    expect(authCallbackHref({ code: "abc", type: ["recovery"] })).toBe("/auth/callback?code=abc&type=recovery");
  });
  it("a recovery link stores the resume marker and reports recovery", async () => {
    const storage = memory();
    await expect(completeAuthCallback(new URL("https://q.example/auth/callback?code=abc"), storage, client({ event: "PASSWORD_RECOVERY" }))).resolves.toBe("recovery");
    expect(JSON.parse(storage.getItem(RECOVERY_STORAGE_KEY)!).userId).toBe("u1");
  });
  it("a confirmation link signs in without a recovery marker", async () => {
    const storage = memory();
    await expect(completeAuthCallback(new URL("https://q.example/auth/callback?code=abc"), storage, client({ event: "SIGNED_IN" }))).resolves.toBe("session");
    expect(storage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });
  it("token_hash links are verified", async () => {
    const c = client();
    await expect(completeAuthCallback(new URL("https://q.example/auth/callback?token_hash=h&type=recovery"), memory(), c)).resolves.toBe("recovery");
    expect((c as unknown as { auth: { verifyOtp: ReturnType<typeof vi.fn> } }).auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "recovery" });
  });
  it("expired and spent links fail with the right reason", async () => {
    await expect(completeAuthCallback(new URL("https://q.example/auth/callback?error=access_denied&error_code=otp_expired"), memory(), client())).rejects.toMatchObject({ reason: "expired" });
    await expect(completeAuthCallback(new URL("https://q.example/auth/callback?code=abc"), memory(), client({ sess: null }))).rejects.toBeInstanceOf(RecoveryLinkError);
  });
});
