import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { call } from "@/lib/api/platform";
import { flagsFromSettings, parseBands, type FlagMap, type ProficiencyBand } from "@/lib/core/config";
import type { MyRoles, PlatformRole, RelationshipPermission } from "@/lib/core/roles";

// Thin clients over the core-platform RPCs (migration 20261007100000). All authorization is server-side.
export type RelationshipType = "guardian" | "sponsor";
export type RelationshipAction = "verify" | "consent" | "withdraw" | "suspend" | "reinstate" | "revoke";
export type Relationship = {
  id: string; source_user_id: string; target_user_id: string; relationship_type: string; status: string;
  can_fund: boolean; can_view_progress: boolean; can_manage_account: boolean; consent_status: string;
};
export type Wallet = { purchased_balance: number; promotional_balance: number; status: string };
export type PaymentIntent = { id: string; reference: string; status: string; coins: number; amount_minor: number; currency_code: string; beneficiary_user_id: string; payer_user_id: string };

export const getMyRoles = () => call<MyRoles>("qb_my_roles");
export const switchWorkspace = (role: PlatformRole, institutionId: string | null = null, app: string | null = null) =>
  call("qb_switch_workspace", { p_role: role, p_institution: institutionId, p_app: app });

export const requestRelationship = (target: string, type: RelationshipType, canFund = false, canViewProgress = false) =>
  call<Relationship>("qb_relationship_request", { p_target: target, p_type: type, p_can_fund: canFund, p_can_view_progress: canViewProgress });
export const decideRelationship = (id: string, action: RelationshipAction, flags: Partial<Record<RelationshipPermission, boolean>> = {}) =>
  call<Relationship>("qb_relationship_decide", { p_id: id, p_action: action, p_flags: flags });
export const relationshipAllows = (target: string, permission: RelationshipPermission) => call<boolean>("qb_relationship_allows", { p_target: target, p_perm: permission });
export const featureAllowed = (feature: string) => call<boolean>("qb_feature_allowed", { p_feature: feature });

export const createPaymentIntent = (beneficiary: string, coins: number, currency: string, provider: string, method: "mobile_money" | "card" | "bank_transfer", idempotencyKey: string) =>
  call<PaymentIntent>("qb_payment_intent_create", { p_beneficiary: beneficiary, p_coins: coins, p_currency: currency, p_provider: provider, p_method: method, p_idem: idempotencyKey });

// Row reads rely on RLS (own wallet / own intents / own relationships only).
export async function getMyWallet(userId: string): Promise<Wallet | null> {
  const { data, error } = await getSupabaseBrowserClient().from("wallets").select("purchased_balance,promotional_balance,status").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as Wallet | null;
}
export async function listMyRelationships(): Promise<Relationship[]> {
  const { data, error } = await getSupabaseBrowserClient().from("account_relationships").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Relationship[];
}
export async function loadFlags(): Promise<FlagMap> {
  const { data, error } = await getSupabaseBrowserClient().from("platform_settings").select("key,value").eq("scope_type", "global").like("key", "flags.%");
  if (error) throw error;
  return flagsFromSettings(data ?? []);
}
export async function loadProficiencyBands(curriculumId?: string): Promise<readonly ProficiencyBand[]> {
  const rows = (await getSupabaseBrowserClient().from("platform_settings").select("scope_type,scope_id,value").eq("key", "proficiency.bands")).data ?? [];
  const match = rows.find((r) => r.scope_type === "curriculum" && r.scope_id === curriculumId) ?? rows.find((r) => r.scope_type === "global");
  return parseBands(match?.value);
}
