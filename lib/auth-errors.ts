import { userFacingError } from "@/lib/errors";

// Supabase Auth (GoTrue) error codes -> sign-in / sign-up / reset copy. Codes are matched first; the message is the fallback,
// so a wording change on the server never collapses a known failure into the generic "could not be completed" text.
const AUTH_CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: "The email or password is incorrect.",
  email_not_confirmed: "Verify your email first. Open the link in the confirmation email, then sign in.",
  user_banned: "This account is suspended. Contact your school or QuizBox support.",
  user_not_found: "The email or password is incorrect.",
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  over_email_send_rate_limit: "Too many emails were requested. Wait a few minutes before requesting another.",
  captcha_failed: "Security check failed. Refresh the page and try again.",
  email_address_invalid: "Enter a valid email address.",
  email_exists: "An account with this email already exists. Sign in or reset your password.",
  user_already_exists: "An account with this email already exists. Sign in or reset your password.",
  weak_password: "That password is too easy to guess. Try two or three words together, like \"blue mango river\".",
  same_password: "Choose a password different from your current password.",
  signup_disabled: "New registrations are temporarily closed.",
  email_provider_disabled: "Email sign-in is temporarily unavailable.",
  session_expired: "Your session expired. Sign in again.",
  session_not_found: "Your session expired. Sign in again.",
  refresh_token_not_found: "Your session expired. Sign in again.",
  request_timeout: "The server took too long to respond. Try again.",
  validation_failed: "Check the email and password and try again.",
};

const AUTH_MESSAGE_MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, AUTH_CODE_MESSAGES.invalid_credentials],
  [/email not confirmed/i, AUTH_CODE_MESSAGES.email_not_confirmed],
  [/rate limit|too many requests/i, AUTH_CODE_MESSAGES.over_request_rate_limit],
  [/user is banned/i, AUTH_CODE_MESSAGES.user_banned],
  [/already registered|already exists/i, AUTH_CODE_MESSAGES.user_already_exists],
  [/password should|weak password|pwned|leaked/i, AUTH_CODE_MESSAGES.weak_password],
];

export const NETWORK_MESSAGE = "Can't reach QuizBox right now. Check your internet connection and try again.";

const field = (error: unknown, key: string) => (typeof error === "object" && error !== null && key in error ? String((error as Record<string, unknown>)[key] ?? "") : "");

export function isNetworkError(error: unknown) {
  const name = field(error, "name"), message = field(error, "message") || String(error ?? "");
  return name === "AuthRetryableFetchError" || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message) || field(error, "status") === "0";
}

// The readable reason for an auth failure. Falls back to the app-wide code table, and finally to a message that carries a short
// reference (status/code) so support can identify the failure instead of an opaque generic sentence.
export function authErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return NETWORK_MESSAGE;
  const code = field(error, "code"), message = field(error, "message") || String(error ?? "");
  if (code && AUTH_CODE_MESSAGES[code]) return AUTH_CODE_MESSAGES[code];
  for (const [pattern, text] of AUTH_MESSAGE_MESSAGES) if (pattern.test(message)) return text;
  const known = userFacingError(error);
  if (!known.startsWith("The operation could not be completed")) return known;
  const status = field(error, "status");
  const reference = [status && `HTTP ${status}`, code || (message && message.slice(0, 60))].filter(Boolean).join(" · ");
  return `Sign-in could not be completed${reference ? ` (${reference})` : ""}. Please try again or contact support.`;
}
