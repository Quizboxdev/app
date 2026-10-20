import { cronAuthorised, cronConfigured } from "@/lib/cron/auth";
import { runDraftSweep } from "@/lib/drafts/sweep";
import { admin, reply } from "@/lib/managed/server";

// Deletes expired drafts and sends the two-hour warnings. The push route runs the same sweep, so no extra schedule is needed; this one exists so it can also be
// scheduled on its own. Closed unless CRON_SECRET is set. The answer carries counts only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!cronConfigured()) return reply(503, { ok: false, error: "Not configured." });
  if (!cronAuthorised(request)) return reply(401, { ok: false });
  try { return reply(200, { ok: true, ...(await runDraftSweep(admin())) }); } catch { return reply(502, { ok: false, error: "The sweep failed." }); }
}
