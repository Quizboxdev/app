import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { clientHash, withinLimit } from "@/lib/partner/api-auth";
import { MAX_EVENT_BYTES, decryptSecret, verifyWebhookSignature } from "@/lib/partner/crypto";
import { errorResponse, mapDbError, okResponse } from "@/lib/partner/errors";
import { applyEvent, parseEvent, payloadHash } from "@/lib/partner/events";
import { isUuid, readRawBody } from "@/lib/partner/http";

// POST /api/partner/v1/events: signed events from a partner (see docs/partner-gateway/05_WEBHOOK_REFERENCE.md).
// Headers: X-QuizBox-Partner = the partner id; X-QuizBox-Signature = t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">. The body is read raw because the signature covers the exact bytes.
// Order of checks: size, caller rate limit, signature (5 minute window), per-partner rate limit, JSON and schema, idempotency, then the action. Unsigned or badly signed calls change nothing.
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdminClient();
    if (!(await withinLimit(admin, `ip:${clientHash(req)}:events`, 120, 60))) return errorResponse("RATE_LIMITED", 60);
    const partner = req.headers.get("x-quizbox-partner");
    if (!isUuid(partner)) return errorResponse("SIGNATURE_INVALID");
    const body = await readRawBody(req, MAX_EVENT_BYTES);
    if (!body.ok) return body.response;
    const { data: encrypted, error: secErr } = await admin.rpc("qb_partner_webhook_secrets_active", { p_partner: partner });
    if (secErr) return errorResponse(mapDbError(secErr.message) === "FEATURE_DISABLED" ? "FEATURE_DISABLED" : "SIGNATURE_INVALID");
    const secrets: string[] = [];
    for (const enc of (encrypted ?? []) as string[]) { try { secrets.push(decryptSecret(enc)); } catch { /* a secret that cannot be read is skipped, never logged */ } }
    if (!verifyWebhookSignature(body.raw, req.headers.get("x-quizbox-signature"), secrets).ok) return errorResponse("SIGNATURE_INVALID");
    if (!(await withinLimit(admin, `p:${partner}:events`, 300, 60))) return errorResponse("RATE_LIMITED", 60);

    let json: Record<string, unknown>;
    try { const j = JSON.parse(body.raw); if (j === null || typeof j !== "object" || Array.isArray(j)) return errorResponse("INVALID_REQUEST"); json = j; } catch { return errorResponse("INVALID_REQUEST"); }
    const parsed = parseEvent(json);
    if (!parsed.ok) return errorResponse(parsed.code);
    const event = parsed.event;
    const { data: begin, error: beginErr } = await admin.rpc("qb_partner_event_begin", { p_partner: partner, p_event_id: event.id, p_type: event.type, p_sha256: payloadHash(body.raw) });
    if (beginErr) return errorResponse(mapDbError(beginErr.message));
    if (begin?.state === "duplicate") return okResponse({ status: "duplicate", event_id: event.id });
    try {
      const result = await applyEvent(admin, partner, event);
      await admin.rpc("qb_partner_event_finish", { p_partner: partner, p_event_id: event.id, p_ok: true });
      return okResponse({ status: result.applied ? "processed" : "ignored", event_id: event.id });
    } catch (e: any) {
      const code = mapDbError(e?.message);
      const permanent = code !== "INTERNAL" && code !== "FEATURE_DISABLED";             // a rule refusal will fail every time: record it, answer with the reason, do not loop
      await admin.rpc("qb_partner_event_finish", { p_partner: partner, p_event_id: event.id, p_ok: false, p_error: code });
      return permanent ? errorResponse(code) : errorResponse("EVENT_PROCESSING_FAILED");
    }
  } catch { return errorResponse("INTERNAL"); }
}

