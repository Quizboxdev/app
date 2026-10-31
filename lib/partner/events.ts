import type { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { isRef, isUuid } from "./http";
import { sha256Hex } from "./crypto";

// Inbound partner events: validation and dispatch. An event can allocate or revoke seats INSIDE the capacity QuizBox already approved, or change the billing reference text. It can never
// raise capacity, move dates or change a contract's state: those exist only as staff actions in the database.
type Admin = ReturnType<typeof getSupabaseAdminClient>;
export const EVENT_TYPES = ["partner.seat.allocated", "partner.seat.revoked", "partner.member.updated", "partner.contract.reference_updated"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type PartnerEvent = { id: string; type: EventType; data: Record<string, unknown> };

export function parseEvent(json: Record<string, unknown>): { ok: true; event: PartnerEvent } | { ok: false; code: "INVALID_REQUEST" | "EVENT_UNSUPPORTED" } {
  const { id, type, data } = json;
  if (typeof id !== "string" || id.length < 1 || id.length > 200 || /[\u0000-\u001f]/.test(id)) return { ok: false, code: "INVALID_REQUEST" };
  if (typeof type !== "string") return { ok: false, code: "INVALID_REQUEST" };
  if (!(EVENT_TYPES as readonly string[]).includes(type)) return { ok: false, code: "EVENT_UNSUPPORTED" };
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, code: "INVALID_REQUEST" };
  const d = data as Record<string, unknown>;
  const valid =
    type === "partner.seat.allocated" ? isUuid(d.contract_id) && isRef(d.external_ref) && (d.kind === undefined || d.kind === "learner" || d.kind === "staff")
    : type === "partner.seat.revoked" ? isRef(d.external_ref) && (d.reason === undefined || (typeof d.reason === "string" && d.reason.length <= 200))
    : type === "partner.member.updated" ? isRef(d.external_ref) && typeof d.active === "boolean"
    : isUuid(d.contract_id) && typeof d.billing_reference === "string" && d.billing_reference.length >= 1 && d.billing_reference.length <= 200;
  return valid ? { ok: true, event: { id, type: type as EventType, data: d } } : { ok: false, code: "INVALID_REQUEST" };
}

export const payloadHash = (raw: string) => sha256Hex(raw);

// Runs the event against the database. Throws the database error message so the caller can map it and mark the event failed.
export async function applyEvent(admin: Admin, partnerId: string, e: PartnerEvent): Promise<{ applied: boolean }> {
  const d = e.data;
  const call = async (fn: string, args: Record<string, unknown>) => { const { error } = await admin.rpc(fn, args); if (error) throw new Error(error.message); };
  switch (e.type) {
    case "partner.seat.allocated":
      await call("qb_partner_seat_allocate", { p_partner: partnerId, p_contract: d.contract_id, p_external_ref: d.external_ref, p_user: null, p_kind: d.kind ?? "learner" }); return { applied: true };
    case "partner.seat.revoked":
      await call("qb_partner_seat_revoke", { p_partner: partnerId, p_external_ref: d.external_ref, p_reason: d.reason ?? "partner event" }); return { applied: true };
    case "partner.member.updated":
      if (d.active === false) { await call("qb_partner_seat_revoke", { p_partner: partnerId, p_external_ref: d.external_ref, p_reason: "member deactivated by partner" }); return { applied: true }; }
      return { applied: false };            // a partner cannot switch a seat back on: allocate a seat again, which is checked against capacity
    case "partner.contract.reference_updated":
      await call("qb_partner_contract_reference_update", { p_partner: partnerId, p_contract: d.contract_id, p_ref: d.billing_reference }); return { applied: true };
  }
}
