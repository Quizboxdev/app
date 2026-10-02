import { getSupabaseBrowserClient } from "./supabase/client";

export const RESET_PASSWORD_PATH = "/auth/reset-password";
export const RESET_SUCCESS_PATH = "/login?password_reset=success";
export const RESET_SUCCESS_MESSAGE = "Password updated. Sign in with your new password.";
export const INVALID_RESET_MESSAGE = "This password reset link is invalid or expired. Request a new reset email.";
export const RECOVERY_STORAGE_KEY = "quizbox-password-recovery";
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
  if (password.length < 8) return "Password must contain at least 8 characters.";
  if (password !== confirmation) return "Passwords do not match.";
  return null;
}

export async function initializePasswordRecovery(url: URL, storage: RecoveryStorage, currentUrl: () => URL, client = getSupabaseBrowserClient()) {
  const hash = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.has("error") || url.searchParams.has("error_code") || hash.has("error") || hash.has("error_code")) throw new Error(INVALID_RESET_MESSAGE);
  let recoveredUserId: string | undefined;
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") recoveredUserId = session?.user.id;
  });
  try {
    // The existing PKCE browser client exchanges the URL code and writes its session cookies.
    const initialized = await client.auth.initialize();
    if (initialized.error || (url.searchParams.has("code") && currentUrl().searchParams.has("code"))) throw new Error(INVALID_RESET_MESSAGE);
    const { data: { session }, error } = await client.auth.getSession();
    const verified = await client.auth.getUser();
    if (error || !session || verified.error || verified.data.user?.id !== session.user.id) throw new Error(INVALID_RESET_MESSAGE);
    let marker: RecoveryMarker | null = null;
    try { marker = JSON.parse(storage.getItem(RECOVERY_STORAGE_KEY) ?? "null"); } catch { /* Unavailable storage must not turn a normal login into recovery. */ }
    const resumed = !url.searchParams.has("code") && marker?.userId === session.user.id && marker.expiresAt > Date.now();
    if (recoveredUserId !== session.user.id && !resumed) throw new Error(INVALID_RESET_MESSAGE);
    const expiresAt = (session.expires_at ?? 0) * 1000;
    if (expiresAt <= Date.now()) throw new Error(INVALID_RESET_MESSAGE);
    try { storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify({ userId: session.user.id, expiresAt })); } catch { /* This session can still reset; refresh continuity is unavailable. */ }
    return session.user.id;
  } finally { subscription.unsubscribe(); }
}

export async function updateRecoveryPassword(password: string, confirmation: string, userId: string, storage: RecoveryStorage, client: Client = getSupabaseBrowserClient()) {
  const validation = validateResetPasswords(password, confirmation);
  if (validation) throw new Error(validation);
  const verified = await client.auth.getUser();
  if (verified.error || verified.data.user?.id !== userId) throw new Error(INVALID_RESET_MESSAGE);
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
  try { storage.removeItem(RECOVERY_STORAGE_KEY); } catch { /* A signed-out session cannot reuse the marker. */ }
  try { await client.auth.signOut({ scope: "local" }); } catch { /* The password update already succeeded; login displays that result. */ }
  return RESET_SUCCESS_PATH;
}

export function recoveryErrorMessage(error: unknown) {
  if (error instanceof Error && [INVALID_RESET_MESSAGE, "Both password fields are required.", "Password must contain at least 8 characters.", "Passwords do not match."].includes(error.message)) return error.message;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (["session_not_found", "session_expired", "refresh_token_not_found", "refresh_token_already_used", "otp_expired"].includes(code)) return INVALID_RESET_MESSAGE;
  if (code === "weak_password") return "Choose a stronger password that meets the password policy.";
  if (code === "same_password") return "Choose a password different from your current password.";
  return "The request could not be completed. Please try again.";
}
