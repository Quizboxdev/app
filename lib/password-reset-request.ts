export const RESET_EMAIL_SENT = "Reset email sent. Please check your inbox before requesting another.";
export const RESET_EMAIL_SPAM_HINT = "It can take up to 5 minutes to arrive. If you cannot see it, check your spam or junk folder. Requesting again and again slows it down.";
export const RESET_EMAIL_RATE_LIMIT = "Too many reset emails have been requested. Please wait before trying again.";
export const RESET_EMAIL_COOLDOWN_MS = 60_000;
const COOLDOWN_KEY = "qb-reset-email-available-at";

export function isResetEmailRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: number; code?: string };
  return value.status === 429 || value.code === "over_email_send_rate_limit";
}

// Where the "wait before asking again" time is kept so a page refresh does not clear it. Optional; without it the wait lives in memory only.
export type CooldownStore = { read: () => number; write: (availableAt: number) => void };

export function browserCooldownStore(): CooldownStore | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    read: () => { try { const value = Number(window.localStorage.getItem(COOLDOWN_KEY)); return Number.isFinite(value) ? value : 0; } catch { return 0; } },
    write: (availableAt) => { try { window.localStorage.setItem(COOLDOWN_KEY, String(availableAt)); } catch { /* the wait still holds while this page stays open */ } },
  };
}

export function createResetEmailRequest(now = Date.now, store?: CooldownStore) {
  let pending = false;
  let availableAt = 0;
  const wait = () => Math.max(availableAt, store?.read() ?? 0);
  const startCooldown = () => { availableAt = now() + RESET_EMAIL_COOLDOWN_MS; store?.write(availableAt); };
  return {
    remainingSeconds: () => Math.max(0, Math.ceil((wait() - now()) / 1000)),
    async send(request: () => Promise<void>): Promise<boolean> {
      if (pending || now() < wait()) return false;
      pending = true;
      try {
        await request();
        startCooldown();
        return true;
      } catch (error) {
        if (isResetEmailRateLimit(error)) startCooldown();
        throw error;
      } finally {
        pending = false;
      }
    },
  };
}
