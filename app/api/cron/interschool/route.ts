import { cronAuthorised, cronConfigured } from "@/lib/cron/auth";
import { admin, reply } from "@/lib/managed/server";
import { logFallback } from "@/lib/ops/log";

// Sends inter-school reminders (registration closing within two days, rounds opening within a day), each once. Closed unless CRON_SECRET is set. Counts only in the answer.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!cronConfigured()) return reply(503, { ok: false, error: "Not configured." });
  if (!cronAuthorised(request)) return reply(401, { ok: false });
  try {
    const { data, error } = await admin().rpc("interschool_send_reminders");
    if (error) { logFallback("cron-interschool", "reminders were not sent", error); return reply(502, { ok: false, error: "The reminders failed." }); }
    return reply(200, { ok: true, ...(data as object) });
  } catch (e) { logFallback("cron-interschool", "reminders were not sent", e); return reply(502, { ok: false, error: "The reminders failed." }); }
}
