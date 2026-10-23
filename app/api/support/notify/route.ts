import { authenticate, admin, isUuid, readJson, reply } from "@/lib/managed/server";
import { emailRequesterReply, emailStaffNew, type SupportRequestRow } from "@/lib/support/server";

// Emails after something happens on a request. The caller says what ("created" or "replied" by the person, "staff_replied" by support); the database confirms they may act on that request,
// and the server decides who to email. A signed-in person is told there is a reply (never the private text); a visitor gets the reply itself. At most 60 a hour per person.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false });
  const body = await readJson(request);
  const event = String(body?.event ?? ""), requestId = String(body?.requestId ?? "");
  if (!["created", "replied", "staff_replied"].includes(event) || !isUuid(requestId)) return reply(400, { ok: false });
  const allowed = await who.client.rpc("qb_support_request_authorize", { p_id: requestId });
  if (allowed.error) return reply(404, { ok: false });
  const kind = (allowed.data as { kind: string }).kind;
  if ((event === "staff_replied") !== (kind === "staff")) return reply(403, { ok: false });
  const svc = admin();
  const budget = await svc.rpc("qb_consume_budget", { p_key: `support-notify:${who.user.id}`, p_limit: 60, p_seconds: 3600 });
  if (budget.error || budget.data === false) return reply(429, { ok: false });
  const found = await svc.from("support_requests").select("id, reference, subject, category, requester_name, requester_email, requester_user_id, status").eq("id", requestId).maybeSingle();
  const row = found.data as SupportRequestRow | null;
  if (!row) return reply(404, { ok: false });
  if (event === "staff_replied") {
    const last = await svc.from("support_request_messages").select("body").eq("request_id", requestId).eq("author_kind", "staff").eq("internal", false).order("created_at", { ascending: false }).limit(1).maybeSingle();
    await emailRequesterReply(row, String((last.data as { body?: string } | null)?.body ?? ""));
  } else await emailStaffNew(svc, row, event === "replied");
  return reply(200, { ok: true });
}
