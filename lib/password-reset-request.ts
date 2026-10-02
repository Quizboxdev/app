export const RESET_EMAIL_SENT = "Reset email sent. Please check your inbox before requesting another.";
export const RESET_EMAIL_RATE_LIMIT = "Too many reset emails have been requested. Please wait before trying again.";
export const RESET_EMAIL_COOLDOWN_MS = 60_000;

export function isResetEmailRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: number; code?: string };
  return value.status === 429 || value.code === "over_email_send_rate_limit";
}

export function createResetEmailRequest(now = Date.now) {
  let pending = false;
  let availableAt = 0;
  return {
    remainingSeconds: () => Math.max(0, Math.ceil((availableAt - now()) / 1000)),
    async send(request: () => Promise<void>): Promise<boolean> {
      if (pending || now() < availableAt) return false;
      pending = true;
      try {
        await request();
        availableAt = now() + RESET_EMAIL_COOLDOWN_MS;
        return true;
      } catch (error) {
        if (isResetEmailRateLimit(error)) availableAt = now() + RESET_EMAIL_COOLDOWN_MS;
        throw error;
      } finally {
        pending = false;
      }
    },
  };
}
