import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Affiliates and commission (migration 20261048100000). The database decides who may apply, who is approved, what is attributed, every rate, the cap, the hold and every ledger entry; this file only asks and shows.
// Customers are never identified to an affiliate: only counts, amounts and dates.
export type Payout = { method: "mobile_money" | "bank"; network: string; account_masked: string; account_name: string; verified: boolean };
export type AffiliateMe = { enabled: boolean; applied: boolean; id?: string; status?: "applied" | "approved" | "suspended" | "rejected" | "terminated"; tier?: Tier; display_name?: string; phone?: string; decision_note?: string; referral_code?: string | null; payout?: Payout | null };
export type Tier = "registered" | "growth" | "ambassador";
export type Balances = { pending: number; available: number; reserved: number; paid: number };
export type AffiliateSummary = {
  status: string; tier: Tier; referral_code: string | null; balances: Balances;
  referrals: { signed_up: number; paid: number; in_window: number; growth_at: number | null; ambassador_at: number | null; window_days: number | null };
  policy: { version: number; hold_days: number; min_payout_minor: number; rates: Record<Tier, number>; pilot: boolean } | null;
  recent: { created_at: string; amount_minor: number; status: string; release_at: string; rate_percent: number }[];
};
export type ApplicationInput = { display_name: string; phone: string; adult: boolean; accept_terms: boolean };
export type PayoutInput = { method: "mobile_money" | "bank"; network: string; account: string; account_name: string };

export type AdminAffiliate = { id: string; name: string; email: string; phone: string; status: string; tier: Tier; code: string; applied_at: string; has_payout_details: boolean; payout_verified: boolean; referrals: number; paid_referrals: number };
export type Policy = {
  id: string; version: number; name: string; status: "draft" | "approved" | "retired"; is_pilot: boolean; tier_rates: Record<Tier, number>; growth_min_referrals: number; ambassador_min_referrals: number; tier_window_days: number;
  acquisition_cap_percent: number; hold_days: number; attribution_window_days: number; min_payout_minor: number; tax_percent: number; eligible_purposes: string[]; note: string; created_at: string; approved_at: string | null;
};
export type PolicyInput = { name: string; rates: Record<Tier, number>; growth: number; ambassador: number; tierWindow: number; cap: number; hold: number; window: number; minPayoutMinor: number; tax: number; purposes: string[]; pilot: boolean; note: string };
export type AdminSummary = {
  enabled: boolean; policy: { version: number; name: string; pilot: boolean; cap_percent: number; hold_days: number } | null; affiliates: Record<string, number>; balances: Partial<Balances>;
  accruals: Record<string, { count: number; amount_minor: number }>; cap_clipped_minor: number; ledger_total_minor: number;
};
export type AdminAccrual = { id: string; reference: string; affiliate: string; tier: Tier; rate_percent: number; gross_minor: number; tax_minor: number; net_minor: number; amount_minor: number; cap_clipped_minor: number; status: string; release_at: string; created_at: string; policy_version: number };

export const TIER_LABEL: Record<Tier, string> = { registered: "Registered Affiliate", growth: "Growth Partner", ambassador: "QuizBox Ambassador" };
export const AFFILIATE_STATUS: Record<string, string> = { applied: "Waiting for review", approved: "Approved", suspended: "Paused", rejected: "Not approved", terminated: "Ended" };
export const ACCRUAL_STATUS: Record<string, string> = { pending: "Held", approved: "Approved", payable: "In a payout", paid: "Paid", reversed: "Reversed (refund)" };
export const shareLink = (origin: string, code: string) => `${origin.replace(/\/$/, "")}/r/${code}`;

const MESSAGES: Record<string, string> = {
  QB_AUTHENTICATION_REQUIRED: "Please sign in.", QB_FORBIDDEN: "You do not have permission to do that.", QB_NOT_FOUND: "We could not find that.", QB_FEATURE_DISABLED: "The affiliate programme is not open yet.",
  QB_ADULTS_ONLY: "The affiliate programme is for adults. Children and school-managed learners cannot join.", QB_ADULT_ATTESTATION_REQUIRED: "Please confirm that you are 18 or older.", QB_TERMS_REQUIRED: "Please accept the affiliate terms.",
  QB_AFFILIATE_INVALID: "Check your name and phone number.", QB_AFFILIATE_BLOCKED: "This affiliate account is paused or ended. Please contact support.", QB_PAYOUT_INVALID: "Check the payout details. The account number must be digits only.",
  QB_IDENTITY_CHECK_REQUIRED: "Confirm that you checked the person's identity and that they are an adult.", QB_PAYOUT_DETAILS_REQUIRED: "They must add payout details before they can be approved.", QB_INVALID_TRANSITION: "That change is not allowed from the current status.",
  QB_INVALID_ACTION: "That choice is not allowed.", QB_REASON_REQUIRED: "Please write a short reason.", QB_POLICY_INVALID: "Check the policy numbers. Rates must be 0 to 100, and the Ambassador threshold must be higher than Growth.",
  QB_SECOND_APPROVER_REQUIRED: "A different person must approve this policy.", QB_NOT_A_DRAFT: "Only a draft can be approved.", QB_RATE_LIMITED: "Too many requests. Wait a minute and try again.",
};
const message = (e: { message?: string }) => MESSAGES[/(QB_[A-Z_]+)/.exec(e.message ?? "")?.[1] ?? ""] ?? "That did not work. Please try again.";
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => { if (error) throw new Error(message(error)); return data as T; });

// The signed-in person
export const affiliateMe = () => rpc<AffiliateMe>("qb_affiliate_me");
export const affiliateApply = (i: ApplicationInput) => rpc<{ id: string; status: string }>("qb_affiliate_apply", { p_display_name: i.display_name, p_phone: i.phone, p_adult: i.adult, p_accept_terms: i.accept_terms });
export const affiliatePayoutSave = (i: PayoutInput) => rpc<AffiliateMe>("qb_affiliate_payout_save", { p_method: i.method, p_network: i.network, p_account: i.account, p_account_name: i.account_name });
export const affiliateSummary = () => rpc<AffiliateSummary>("qb_affiliate_summary");

// A customer who arrived with a code (called once after sign-in; see lib/referral/capture.ts)
export const referralCapture = (code: string, source = "link", campaign = "") => rpc<{ outcome: string }>("qb_referral_capture", { p_code: code, p_source: source, p_campaign: campaign });

// Staff (owner, super admin, finance admin)
export const adminAffiliates = (status = "applied") => rpc<AdminAffiliate[]>("qb_affiliate_admin_list", { p_status: status });
export const adminDecide = (id: string, action: "approve" | "reject" | "suspend" | "reinstate" | "terminate", note: string, identityVerified = false) =>
  rpc<{ id: string; status: string }>("qb_affiliate_decide", { p_id: id, p_action: action, p_note: note, p_identity_verified: identityVerified });
export const adminSummary = () => rpc<AdminSummary>("qb_commission_admin_summary");
export const adminAccruals = (status: string | null = null, limit = 100) => rpc<AdminAccrual[]>("qb_commission_admin_accruals", { p_status: status, p_limit: limit });
export const adminReverse = (reference: string, reason: string) => rpc<{ outcome: string; reversed: number }>("qb_commission_admin_reverse", { p_reference: reference, p_reason: reason });
export const policies = () => rpc<Policy[]>("qb_commission_policies_list");
export const policySave = (i: PolicyInput) => rpc<Policy>("qb_commission_policy_save", {
  p_name: i.name, p_tier_rates: i.rates, p_growth_min: i.growth, p_ambassador_min: i.ambassador, p_tier_window_days: i.tierWindow, p_cap: i.cap, p_hold_days: i.hold, p_window_days: i.window,
  p_min_payout_minor: i.minPayoutMinor, p_tax_percent: i.tax, p_purposes: i.purposes, p_pilot: i.pilot, p_note: i.note,
});
export const policyApprove = (id: string) => rpc<Policy>("qb_commission_policy_approve", { p_id: id });

// The programme switch. Only the owner or a super admin can change it (the database checks); a finance admin cannot.
export async function affiliateSwitch(on: boolean) {
  const { error } = await getSupabaseBrowserClient().rpc("qb_setting_set", { p_key: "flags.affiliates", p_value: on });
  if (error) throw new Error("Only the owner or a super admin can switch the programme on or off.");
}
