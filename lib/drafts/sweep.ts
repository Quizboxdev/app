import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/send";
import { SITE_URL } from "@/lib/site";

type Warned = { label?: string; title?: string; path?: string; email?: string | null };
export type SweepCounts = { purged: number; warned: number; emailed: number; skipped: number; failed: number };

// One pass of the draft sweep: the database deletes expired drafts and warns people in the app (bell and phone push); this sends the email for the same warnings.
// Safe to run often and from more than one scheduler: each draft is warned about once. Returns counts only.
export async function runDraftSweep(svc: SupabaseClient): Promise<SweepCounts> {
  const out: SweepCounts = { purged: 0, warned: 0, emailed: 0, skipped: 0, failed: 0 };
  const { data, error } = await svc.rpc("qb_drafts_sweep");
  if (error || !data || typeof data !== "object") return out;
  const body = data as { purged?: number; warned?: Warned[] };
  out.purged = Number(body.purged) || 0;
  const warned = Array.isArray(body.warned) ? body.warned : [];
  out.warned = warned.length;
  for (const w of warned) {
    if (!w.email) { out.skipped += 1; continue; }
    const where = typeof w.path === "string" && /^\/(?!\/)[A-Za-z0-9/_\-?=&.]*$/.test(w.path) ? w.path : "/drafts";
    const result = await sendEmail(w.email, `Your unfinished ${w.label ?? "work"} will be deleted in about 2 hours`,
      `Hello,\n\nYour unfinished ${w.label ?? "work"}${w.title ? ` "${w.title}"` : ""} on QuizBox will be deleted in about 2 hours to keep things tidy.\n\nContinue it here: ${SITE_URL}${where}\n\nAny change you make keeps it for another 24 hours.\n\nQuizBox`);
    if (result === "sent") out.emailed += 1; else if (result === "skipped") out.skipped += 1; else out.failed += 1;
  }
  return out;
}
