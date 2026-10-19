import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Erasing a managed learner has two halves: the database removes the name, username and school (qb_managed_learner_erase), then the sign-in is scrambled
// (a new unreachable address, a random password nobody sees, sign-in blocked for good). Shared by the owner's erase route and the scheduled job.
export type EraseOutcome = { ok: true; already: boolean } | { ok: false; code: "NOT_FOUND" | "INVALID" | "SCRAMBLE_FAILED" };

export async function eraseAndScramble(svc: SupabaseClient, learnerId: string, reason: string): Promise<EraseOutcome> {
  const erased = await svc.rpc("qb_managed_learner_erase", { p_learner: learnerId, p_reason: reason });
  if (erased.error) return { ok: false, code: erased.error.message.includes("QB_MANAGED_LEARNER_NOT_FOUND") ? "NOT_FOUND" : "INVALID" };
  const out = erased.data as { login_email?: string; already?: boolean };
  if (!out.already && out.login_email) {
    const scrambled = await svc.auth.admin.updateUserById(learnerId, { email: out.login_email, password: randomBytes(24).toString("base64url"), ban_duration: "876000h", user_metadata: { full_name: "Former learner", managed: true } });
    if (scrambled.error) return { ok: false, code: "SCRAMBLE_FAILED" };
  }
  return { ok: true, already: Boolean(out.already) };
}
