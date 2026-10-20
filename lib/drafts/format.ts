export type DraftKind = "challenge" | "competition" | "sponsor_competition" | "practice" | "assignment" | "other";

// What each kind is called on screen and in messages (the database sends the same words in its warning).
export const DRAFT_LABEL: Record<DraftKind, string> = {
  challenge: "challenge", competition: "competition", sponsor_competition: "sponsored competition", practice: "practice set", assignment: "assignment", other: "work",
};
export const WARN_MS = 2 * 3_600_000;

// "3h 10m", "45 min", "less than a minute", "expired".
export function timeLeft(expiresAt: string | number | Date, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
export const expiresSoon = (expiresAt: string | number | Date, now: number = Date.now()): boolean => {
  const ms = new Date(expiresAt).getTime() - now;
  return Number.isFinite(ms) && ms > 0 && ms <= WARN_MS;
};
