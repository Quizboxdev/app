import { timingSafeEqual } from "node:crypto";
import { admin, reply } from "@/lib/managed/server";
import { eraseAndScramble } from "@/lib/managed/erase";

// Scheduled erasure of ended managed learner accounts past the retention period (vercel.json runs this weekly). It does nothing unless the owner has switched
// "Automatic erasure" on (Admin, Young learners) and CRON_SECRET is set; Vercel sends that secret as a bearer token. The answer carries counts only, never names.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BATCH = 25;

const authorised = (request: Request) => {
  const secret = process.env.CRON_SECRET, header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return reply(503, { ok: false, error: "Not configured." });
  if (!authorised(request)) return reply(401, { ok: false });
  const svc = admin();
  const due = await svc.rpc("qb_managed_erasure_due", { p_limit: BATCH });
  if (due.error) return reply(502, { ok: false, error: "Could not read the queue." });
  const list = (due.data ?? []) as { user_id: string; months: number }[];
  let erased = 0, failed = 0;
  for (const l of list) {
    const r = await eraseAndScramble(svc, l.user_id, `Scheduled erasure: ended more than ${l.months} months ago`);
    if (r.ok) erased += 1; else failed += 1;
  }
  return reply(200, { ok: true, due: list.length, erased, failed });
}
