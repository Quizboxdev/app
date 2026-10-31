import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Partner Integrations (migrations 20261049100000 and 20261049200000). Every call here is checked in the database: only a super admin gets an answer. Secrets are never returned after they are issued.
export type PartnerStatus = "draft" | "pending_verification" | "verified" | "suspended" | "revoked";
export type ContractStatus = "draft" | "pending_approval" | "active" | "suspended" | "expired" | "cancelled";
export type ContractRow = { id: string; package: string; status: ContractStatus; live: boolean; starts_on: string; expires_on: string; max_seats: number; allocated: number; billing_ref: string | null; reconciliation: string };
export type PartnerRow = { id: string; name: string; kind: string; country: string | null; status: PartnerStatus; sso: string | null; credentials: number; contracts: ContractRow[]; dead_events: number };
export type Overview = { enabled: boolean; partners: PartnerRow[] };
export type Detail = {
  partner: { id: string; name: string; kind: string; country_code: string | null; status: PartnerStatus; slug: string | null; status_note: string | null };
  identity: { protocol: string; issuer: string; audience: string; jwks_uri: string | null; authorization_endpoint: string | null; token_endpoint: string | null; allowed_domains: string[]; auto_provision: boolean; status: string; has_client_secret: boolean } | null;
  credentials: { id: string; prefix: string; scopes: string[]; status: string; expires_at: string; last_used_at: string | null }[];
  webhook_secret: { status: string; created_at: string } | null;
  contracts: (Omit<ContractRow, "allocated"> & { capabilities: string[]; approval_note: string | null; learner_seats: number; staff_seats: number })[];
};
export type SeatRow = { external_ref: string; kind: "learner" | "staff"; status: string; linked: boolean; allocated_at: string; revoked_at: string | null };
export type EventRow = { id: string; event_id: string; type: string; status: string; attempts: number; error_code: string | null; received_at: string };
export type AuditRow = { action: string; entity: string; actor: string | null; details: Record<string, unknown> };
export const SCOPES = ["licence:read", "seats:read", "seats:write", "members:read", "health:read"] as const;

const db = () => getSupabaseBrowserClient();
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(friendly(error.message));
  return data as T;
}
export function friendly(m: string): string {
  const map: [RegExp, string][] = [
    [/QB_NOT_AUTHORIZED|QB_AUTHENTICATION_REQUIRED/, "Only a super admin can use Partner Integrations."], [/QB_NOTE_REQUIRED/, "A note is required."],
    [/QB_PARTNER_NOT_VERIFIED/, "The partner must be verified first."], [/QB_BILLING_REFERENCE_REQUIRED/, "Add the external billing reference before approval."],
    [/QB_SELF_APPROVAL_NOT_ALLOWED/, "A different super admin must approve a contract you created."], [/QB_CONTRACT_ALREADY_EXPIRED/, "The expiry date has passed."],
    [/QB_INVALID_TRANSITION/, "That change is not allowed from the current state."], [/QB_PARTNER_CONTRACT_LOCKED/, "A live contract cannot be edited. Use Amend."],
    [/QB_PARTNER_SEATS_IN_USE/, "More seats are in use than that. Revoke seats first."], [/QB_PARTNER_PUBLIC_DOMAIN/, "Public mail domains (such as gmail.com) cannot be used."],
    [/QB_PARTNER_DOMAIN_INVALID/, "One of the domains is not valid."], [/partners_slug_format/, "The address name must be 3 to 40 lowercase letters, numbers or dashes."],
    [/partner_identity_endpoints_https|check constraint/, "Addresses must start with https://."], [/partners_name_ci|duplicate key/, "That name or address is already used."], [/QB_PARTNER_REVOKED/, "A revoked partner cannot be changed."],
  ];
  return map.find(([re]) => re.test(m))?.[1] ?? "Something went wrong. Check the details and try again.";
}

export const overview = () => call<Overview>("qb_admin_partners_overview");
export const detail = (id: string) => call<Detail>("qb_admin_partner_detail", { p_partner: id });
export const partnerSave = (a: { id?: string; name: string; kind: string; country: string }) => call<{ id: string }>("qb_admin_partner_save", { p_id: a.id ?? null, p_name: a.name, p_kind: a.kind, p_country: a.country || null, p_institution: null });
export const partnerStatus = (id: string, status: string, note: string) => call("qb_admin_partner_set_status", { p_id: id, p_status: status, p_note: note });
export const slugSet = (id: string, slug: string) => call("qb_admin_partner_slug_set", { p_partner: id, p_slug: slug });
export const identitySave = (id: string, a: { issuer: string; audience: string; jwks: string; domains: string[]; autoProvision: boolean; status: string }) =>
  call("qb_admin_partner_identity_save", { p_partner: id, p_protocol: "oidc", p_issuer: a.issuer, p_audience: a.audience, p_jwks_uri: a.jwks || null, p_domains: a.domains, p_auto_provision: a.autoProvision, p_status: a.status });
export const credentialIssue = (id: string, scopes: string[], days: number) => call<{ id: string; key_prefix: string; secret: string; expires_in_days: number }>("qb_admin_partner_credential_issue", { p_partner: id, p_scopes: scopes, p_days: days, p_rotated_from: null });
export const credentialRotate = (id: string) => call<{ secret: string; key_prefix: string }>("qb_admin_partner_credential_rotate", { p_id: id, p_days: 90 });
export const credentialRevoke = (id: string) => call("qb_admin_partner_credential_revoke", { p_id: id });
export type ContractInput = { id?: string; partner: string; pkg: string; caps: string[]; country: string; start: string; end: string; max: number; ref: string };
export const contractSave = (a: ContractInput) => call<{ id: string }>("qb_admin_partner_contract_save", { p_id: a.id ?? null, p_partner: a.partner, p_package: a.pkg, p_caps: a.caps, p_country: a.country || null, p_scope: [], p_grades: [], p_starts: a.start, p_expires: a.end, p_max: a.max, p_ref: a.ref || null });
export const contractSubmit = (id: string) => call("qb_admin_partner_contract_submit", { p_id: id });
export const contractApprove = (id: string, note: string) => call("qb_admin_partner_contract_approve", { p_id: id, p_note: note });
export const contractStatus = (id: string, status: string, note: string) => call("qb_admin_partner_contract_set_status", { p_id: id, p_status: status, p_note: note });
export const contractAmend = (id: string, max: number, expires: string, ref: string, note: string) => call("qb_admin_partner_contract_amend", { p_id: id, p_max: max, p_expires: expires, p_ref: ref || null, p_note: note });
export const contractReconcile = (id: string, state: string) => call("qb_admin_partner_contract_reconcile", { p_id: id, p_state: state });
export const seats = (contract: string) => call<SeatRow[]>("qb_admin_partner_seats", { p_contract: contract });
export const events = (partner: string, status?: string) => call<EventRow[]>("qb_admin_partner_events", { p_partner: partner, p_status: status ?? null });
export const eventRequeue = (id: string) => call("qb_admin_partner_event_requeue", { p_id: id });
export const audit = (partner: string) => call<AuditRow[]>("qb_admin_partner_audit", { p_partner: partner });
export const gatewaySwitch = async (on: boolean) => { const { error } = await db().rpc("qb_setting_set", { p_key: "flags.partner_access_gateway_v1", p_value: on }); if (error) throw new Error("Only the owner or a super admin can switch the gateway."); };

// Secrets that must be encrypted before storage go through the server (it holds the key). The caller's own sign-in token is sent, so the database still checks they are a super admin.
export async function secretAction(body: { kind: "webhook" } | { kind: "oidc"; partner_id: string; authorization_endpoint: string; token_endpoint: string; client_secret?: string }, partnerId: string): Promise<{ secret?: string }> {
  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again.");
  const res = await fetch("/api/admin/partners/secret", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ partner_id: partnerId, ...body }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Could not save the secret.");
  return json;
}
