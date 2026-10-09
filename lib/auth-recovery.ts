import { getSupabaseBrowserClient } from "./supabase/client";
import { isNetworkError, NETWORK_MESSAGE } from "./auth-errors";
import { isEasyToGuess, PASSWORD_MIN_LENGTH, PASSWORD_TOO_EASY, PASSWORD_TOO_SHORT, passwordProblem } from "./password-policy";

// Canonical recovery route. /auth/reset-password (the previous route, already in sent emails and possibly in the Supabase
// allow-list) forwards here with its query and hash intact.
export const RESET_PASSWORD_PATH = "/auth/update-password";
export const LEGACY_RESET_PASSWORD_PATH = "/auth/reset-password";
export const RESET_SUCCESS_PATH = "/login?password_reset=success";
export const RESET_SUCCESS_MESSAGE = "Password updated successfully. Sign in with your new password.";
export const INVALID_RESET_MESSAGE = "This password reset link is invalid or expired. Request a new reset email.";
export { PASSWORD_MIN_LENGTH };
export const PASSWORD_REQUIREMENTS = [`At least ${PASSWORD_MIN_LENGTH} characters`, "Not easy to guess (not 123456 or password)", "Both fields match"] as const;
// Which PASSWORD_REQUIREMENTS are met, in the same order.
export const passwordChecks = (password: string, confirmation: string) =>
  [password.length >= PASSWORD_MIN_LENGTH, password.length >= PASSWORD_MIN_LENGTH && !isEasyToGuess(password), password.length > 0 && password === confirmation];
export const RECOVERY_STORAGE_KEY = "quizbox-password-recovery";

// Why a recovery link cannot be used. The Error message stays INVALID_RESET_MESSAGE; screens show the reason-specific copy.
export type RecoveryFailure = "expired" | "used" | "invalid" | "missing";
export const RECOVERY_FAILURE_MESSAGES: Record<RecoveryFailure, string> = {
  expired: "This password reset link has expired. Request a new reset email.",
  used: "This password reset link has already been used, or it was opened in a different browser from the one that requested it. Request a new reset email.",
  invalid: INVALID_RESET_MESSAGE,
  missing: "Open the link in your password reset email to set a new password, or request a new email.",
};
export class RecoveryLinkError extends Error {
  constructor(readonly reason: RecoveryFailure) { super(INVALID_RESET_MESSAGE); this.name = "RecoveryLinkError"; }
}
export const recoveryFailureMessage = (error: unknown) => RECOVERY_FAILURE_MESSAGES[error instanceof RecoveryLinkError ? error.reason : "invalid"];

type Client = ReturnType<typeof getSupabaseBrowserClient>;
type RecoveryMarker = { userId: string; expiresAt: number };
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const browserRecoveryStorage: RecoveryStorage = {
  getItem: key => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
  removeItem: key => window.sessionStorage.removeItem(key),
};

export async function requestPasswordReset(email: string, origin: string, client = getSupabaseBrowserClient()) {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: new URL(RESET_PASSWORD_PATH, origin).href });
  if (error) throw error;
}

export function validateResetPasswords(password: string, confirmation: string) {
  if (!password || !confirmation) return "Both password fields are required.";
  const problem = passwordProblem(password);
  if (problem) return problem;
  if (password !== confirmation) return "Passwords do not match.";
  return null;
}

const urlFailure = (...params: URLSearchParams[]): RecoveryFailure | null => {
  const has = (key: string) => params.some(p => p.has(key));
  if (!has("error") && !has("error_code")) return null;
  return params.some(p => p.get("error_code") === "otp_expired") ? "expired" : "invalid";
};
// GoTrue reports a spent, foreign-browser or unknown PKCE code as a missing flow state.
const exchangeFailure = (error: unknown): RecoveryFailure => {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const text = error instanceof Error ? error.message : "";
  if (code === "flow_state_expired" || code === "otp_expired" || /expired/i.test(text)) return "expired";
  if (["flow_state_not_found", "bad_code_verifier", "validation_failed"].includes(code) || /flow state|code verifier|verifier/i.test(text)) return "used";
  return "invalid";
};

export async function initializePasswordRecovery(url: URL, storage: RecoveryStorage, currentUrl: () => URL, client = getSupabaseBrowserClient()) {
  const hash = new URLSearchParams(url.hash.slice(1));
  const failure = urlFailure(url.searchParams, hash);
  if (failure) throw new RecoveryLinkError(failure);
  let recoveredUserId: string | undefined;
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") recoveredUserId = session?.user.id;
  });
  try {
    // The existing PKCE browser client exchanges the URL code and writes its session cookies.
    const initialized = await client.auth.initialize();
    if (initialized.error) throw new RecoveryLinkError(exchangeFailure(initialized.error));
    if (url.searchParams.has("code") && currentUrl().searchParams.has("code")) throw new RecoveryLinkError("invalid");
    const { data: { session }, error } = await client.auth.getSession();
    // No link and no session at all: the page was opened directly, not from the email.
    if (!error && !session && !url.searchParams.has("code") && !hash.has("access_token")) throw new RecoveryLinkError("missing");
    const verified = await client.auth.getUser();
    if (error || !session || verified.error || verified.data.user?.id !== session.user.id) throw new RecoveryLinkError("invalid");
    let marker: RecoveryMarker | null = null;
    try { marker = JSON.parse(storage.getItem(RECOVERY_STORAGE_KEY) ?? "null"); } catch { /* Unavailable storage must not turn a normal login into recovery. */ }
    const resumed = !url.searchParams.has("code") && marker?.userId === session.user.id && marker.expiresAt > Date.now();
    // A signed-in user who merely opened this page has a session but no recovery event: that is not a recovery.
    if (recoveredUserId !== session.user.id && !resumed) throw new RecoveryLinkError("missing");
    const expiresAt = (session.expires_at ?? 0) * 1000;
    if (expiresAt <= Date.now()) throw new RecoveryLinkError("expired");
    try { storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify({ userId: session.user.id, expiresAt })); } catch { /* This session can still reset; refresh continuity is unavailable. */ }
    return session.user.id;
  } finally { subscription.unsubscribe(); }
}

export async function updateRecoveryPassword(password: string, confirmation: string, userId: string, storage: RecoveryStorage, client: Client = getSupabaseBrowserClient()) {
  const validation = validateResetPasswords(password, confirmation);
  if (validation) throw new Error(validation);
  const verified = await client.auth.getUser();
  if (verified.error || verified.data.user?.id !== userId) throw new RecoveryLinkError(verified.error || !verified.data.user ? "expired" : "invalid");
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
  try { storage.removeItem(RECOVERY_STORAGE_KEY); } catch { /* A signed-out session cannot reuse the marker. */ }
  // The recovery session is spent: end it so the new password is the only way back in.
  try { await client.auth.signOut({ scope: "local" }); } catch { /* The password update already succeeded; login displays that result. */ }
  return RESET_SUCCESS_PATH;
}

// Which failure, if any, makes the whole link unusable (as opposed to a fixable form error such as a weak password).
export function recoveryFailureOf(error: unknown): RecoveryFailure | null {
  if (error instanceof RecoveryLinkError) return error.reason;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (["otp_expired", "session_expired", "flow_state_expired"].includes(code)) return "expired";
  if (["session_not_found", "refresh_token_not_found", "refresh_token_already_used"].includes(code)) return "used";
  return null;
}

export function recoveryErrorMessage(error: unknown) {
  if (error instanceof Error && [INVALID_RESET_MESSAGE, "Both password fields are required.", PASSWORD_TOO_SHORT, PASSWORD_TOO_EASY, "Passwords do not match."].includes(error.message)) return error.message;
  const failure = recoveryFailureOf(error);
  if (failure) return RECOVERY_FAILURE_MESSAGES[failure];
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "weak_password") return PASSWORD_TOO_EASY;
  if (code === "same_password") return "Choose a password different from your current password.";
  if (code === "email_address_invalid") return "Enter a valid email address.";
  if (isNetworkError(error)) return NETWORK_MESSAGE;
  return "The request could not be completed. Please try again.";
}

export { AUTH_CALLBACK_PATH } from "./auth-links";
export type AuthCallbackResult = "recovery" | "session";

// Exchanges the link (PKCE code or legacy hash tokens) for a session and says what kind of link it was. A recovery link stores the
// same marker initializePasswordRecovery() writes, so /auth/update-password resumes it without a second (impossible) code exchange.
export async function completeAuthCallback(url: URL, storage: RecoveryStorage, client = getSupabaseBrowserClient()): Promise<AuthCallbackResult> {
  const hash = new URLSearchParams(url.hash.slice(1));
  const failure = urlFailure(url.searchParams, hash);
  if (failure) throw new RecoveryLinkError(failure);
  let recovery = url.searchParams.get("type") === "recovery" || hash.get("type") === "recovery";
  const { data: { subscription } } = client.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") recovery = true; });
  try {
    const initialized = await client.auth.initialize();
    if (initialized.error) throw new RecoveryLinkError(exchangeFailure(initialized.error));
    // Custom email templates may link with ?token_hash=&type= instead of a PKCE code.
    const tokenHash = url.searchParams.get("token_hash"), type = url.searchParams.get("type");
    if (tokenHash && type) {
      const verified = await client.auth.verifyOtp({ token_hash: tokenHash, type: type as "recovery" | "signup" | "email" | "invite" | "magiclink" | "email_change" });
      if (verified.error) throw new RecoveryLinkError(exchangeFailure(verified.error));
    }
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session) throw new RecoveryLinkError(url.searchParams.has("code") || tokenHash || hash.has("access_token") ? "used" : "missing");
    if (!recovery) return "session";
    const expiresAt = (session.expires_at ?? 0) * 1000;
    if (expiresAt <= Date.now()) throw new RecoveryLinkError("expired");
    try { storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify({ userId: session.user.id, expiresAt })); } catch { /* the reset form still works in this tab */ }
    return "recovery";
  } finally { subscription.unsubscribe(); }
}

