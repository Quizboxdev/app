import type { StageProgress } from "@/lib/challenges/types";

// Why the Start button is off for the round the player has selected, in words. Null means the round is open (or the rounds have not loaded), so nothing needs saying.
// "Locked", "waiting" and "not through" are already explained next to the round itself, so they get a short pointer to it.
export function stageBlock(s: StageProgress | undefined, noun: string): string | null {
  if (!s || s.state === "OPEN") return null;
  const allowed = s.attempts_allowed ?? 0, used = s.attempts_used ?? 0;
  switch (s.state) {
    case "USED": {
      const best = s.best_score != null && s.best_max != null ? ` Your best score was ${s.best_score} out of ${s.best_max}.` : "";
      return `You have already completed this ${noun}${allowed ? ` (${used} of ${allowed} attempt${allowed === 1 ? "" : "s"} used)` : ""}.${best}`;
    }
    case "CLOSED": return `This round has closed, so it cannot be started any more.`;
    case "NOT_OPEN": return `This round has not opened yet.`;
    case "NOT_THROUGH": return `You did not go through to this round.`;
    case "WAITING": return `This round opens when the round before it closes.`;
    case "LOCKED": return `This round is locked until you pass the round before it.`;
    default: return null;
  }
}
