import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// The owner's refund tools (migration 20261035100000). Every call is checked again in the database: only an owner or a finance admin gets an answer.
export type PaymentFacts = {
  reference: string; status: string; method: string; amount_minor: number; currency: string; coins: number; plan: string | null; created_at: string; settled_at: string | null;
  learner: string; payer: string; credited: boolean; subscription_granted: boolean; coins_spent_after: number; coins_already_returned: number; same_plan_charges_24h: number;
  days_since_payment: number; within_window: boolean; cases: { id: string; kind: string; status: string; coins_credited: number }[];
};
export type RefundCase = { id: string; reference: string; learner: string; kind: string; status: string; coins_credited: number; contact_note: string; decision_note: string; requested_at: string; decided_at: string | null };
export const CASE_KINDS = { duplicate: "Duplicate charge", unapplied: "Paid but not applied", other: "Other" } as const;
export const CASE_STATUS = { open: "Open", credited: "Coins credited", cash_refund_due: "Cash refund due", cash_refunded: "Cash refunded", declined: "Declined" } as const;

const MESSAGES: Record<string, string> = {
  QB_FORBIDDEN: "Only an owner or a finance admin can use the refund tools.",
  QB_QUERY_TOO_SHORT: "Type at least 3 characters: a payment reference or the buyer's email.",
  QB_REASON_REQUIRED: "Write what you checked (at least 10 characters for a credit, 5 for a note).",
  QB_NOT_FOUND: "We could not find that payment or case.",
  QB_PAYMENT_NOT_SETTLED: "That payment was not completed, so there is nothing to return.",
  QB_INVALID_AMOUNT: "Choose a number of Coins from 1 up to the Coins in the payment.",
  QB_OUTSIDE_WINDOW: "This payment is older than 7 days. Tick the exception box only if you are deliberately making an exception.",
  QB_EXCEEDS_PAYMENT: "That would return more Coins than the payment was worth, counting what was already returned.",
  QB_COINS_ALREADY_USED: "Coins from this purchase have been used (or the plan was granted), so a cash refund is not allowed under the policy.",
  QB_CASE_CLOSED: "This case is already closed.",
  QB_INVALID_CASE: "Choose a valid kind and outcome.",
};
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => {
  if (error) { const code = /(QB_[A-Z_]+)/.exec(error.message)?.[1] ?? ""; throw new Error(MESSAGES[code] ?? "That did not work. Please try again."); }
  return data as T;
});
export const findPayments = (query: string) => rpc<PaymentFacts[]>("qb_admin_payment_facts", { p_query: query });
export const refundCases = (limit = 50) => rpc<RefundCase[]>("qb_admin_refund_cases", { p_limit: limit });
export const creditDuplicate = (reference: string, coins: number, reason: string, caseId: string | null, override: boolean) =>
  rpc<{ ok: boolean; replayed: boolean; case: string; coins: number; balance_after?: number }>("qb_admin_refund_credit", { p_reference: reference, p_coins: coins, p_reason: reason, p_case: caseId, p_override: override });
export const saveRefundCase = (reference: string, kind: string, status: string, note: string, caseId: string | null, override: boolean) =>
  rpc<{ id: string; status: string }>("qb_admin_refund_case_save", { p_reference: reference, p_kind: kind, p_status: status, p_note: note, p_case: caseId, p_override: override });
