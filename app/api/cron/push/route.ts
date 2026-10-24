import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { admin, reply } from "@/lib/managed/server";
import { runDraftSweep } from "@/lib/drafts/sweep";
import { logFallback } from "@/lib/ops/log";

// Sends web push for unread in-app notifications. Run it every few minutes by any scheduler that can call a URL with a bearer token (see docs/release/APPLY_PUSH.md).
// Closed unless CRON_SECRET (16+ characters) and the VAPID keys are set. The answer carries counts only: never names, endpoints or message text.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BATCH = 100, PER_REQUEST_MS = 8000;

const authorised = (request: Request) => {
  const secret = process.env.CRON_SECRET, header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };
type Pending = { notification_id: string; title: string; message: string; link: string | null; subscriptions: Sub[] };

export async function GET(request: Request) {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY, subject = process.env.VAPID_SUBJECT || "mailto:support@quizbox.io";
  if (!process.env.CRON_SECRET || !pub || !priv) return reply(503, { ok: false, error: "Not configured." });
  if (!authorised(request)) return reply(401, { ok: false });
  webpush.setVapidDetails(subject, pub, priv);
  const svc = admin();
  const pending = await svc.rpc("qb_push_pending", { p_limit: BATCH });
  if (pending.error) return reply(502, { ok: false, error: "Could not read the queue." });
  const list = (pending.data ?? []) as Pending[];
  const ok: string[] = [], gone: string[] = [], failed: string[] = [];
  let sent = 0;
  for (const n of list) {
    const payload = JSON.stringify({ title: n.title, body: n.message, url: n.link && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(n.link) ? n.link : "/", tag: n.notification_id });
    await Promise.all(n.subscriptions.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, timeout: PER_REQUEST_MS }); ok.push(s.id); sent += 1; }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) gone.push(s.id); else failed.push(s.id); }
    }));
  }
  await svc.rpc("qb_push_report", { p_done: list.map((n) => n.notification_id), p_ok: ok, p_gone: gone, p_failed: failed });
  // The same five-minute run also clears expired drafts and emails the two-hour warnings, so no second schedule is needed. It never affects the push result.
  try { await runDraftSweep(svc); } catch (e) { logFallback("cron-push", "the drafts sweep failed (the push result is unaffected)", e); }
  return reply(200, { ok: true, notifications: list.length, sent, gone: gone.length, failed: failed.length });
}
