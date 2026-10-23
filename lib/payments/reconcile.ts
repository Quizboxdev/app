import type { SupabaseClient } from "@supabase/supabase-js";
import { confirmPayment } from "./confirm";
import { createPaystackProvider } from "./paystack";

// Payment checks for finance staff: finds recent payments that Paystack says were paid but that we did not settle or deliver, and settles them on request.
//   paid_not_recorded   Paystack says success, our record still says initiated or pending (the webhook never arrived)
//   paid_not_delivered  our record says paid and the Coins were credited, but the thing bought (a subscription or a Marketplace set) was never granted
//   waiting             Paystack says the payment is still in progress
//   unpaid              Paystack says abandoned, failed, or never saw it: nobody was charged
// Only Paystack's own answer counts. Settling uses the same idempotent steps as the webhook, so it can never credit or grant twice.
export type Issue = "paid_not_recorded" | "paid_not_delivered" | "waiting" | "unpaid";
export type CheckRow = { reference: string; created_at: string; amount_minor: number; currency: string; purpose: string; what: string; buyer_email: string | null; db_status: string; paystack: string; issue: Issue; can_settle: boolean };
export type CheckResult = { rows: CheckRow[]; checked: number; unreachable: number; since: string };

const OPEN = ["initiated", "pending", "awaiting_approval", "processing"];
type Intent = { reference: string; status: string; amount_minor: number; currency_code: string; created_at: string; credited_tx_id: string | null; beneficiary_user_id: string; metadata: Record<string, unknown> | null };
const purposeOf = (i: Intent) => String(i.metadata?.purpose ?? (i.metadata?.plan ? "subscription" : "coins"));
const whatOf = (i: Intent) => String(i.metadata?.item_title ?? i.metadata?.plan ?? (purposeOf(i) === "coins" ? `${(i.amount_minor / 100).toFixed(0)} Coins` : ""));

export async function findPaymentIssues(admin: SupabaseClient, secretKey: string, opts: { days?: number; minAgeMinutes?: number; maxChecks?: number; fetchImpl?: typeof fetch; now?: Date } = {}): Promise<CheckResult> {
  const now = opts.now ?? new Date(), days = opts.days ?? 14, minAge = (opts.minAgeMinutes ?? 3) * 60000, maxChecks = opts.maxChecks ?? 40;
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const { data } = await admin.from("payment_intents").select("reference, status, amount_minor, currency_code, created_at, credited_tx_id, beneficiary_user_id, metadata").gte("created_at", since).order("created_at", { ascending: false }).limit(400);
  const all = (data ?? []) as Intent[];
  const provider = createPaystackProvider(secretKey, opts.fetchImpl);
  const out: Omit<CheckRow, "buyer_email">[] = [];
  const emails = new Map<string, string>();
  const base = (i: Intent) => ({ reference: i.reference, created_at: i.created_at, amount_minor: Number(i.amount_minor), currency: i.currency_code, purpose: purposeOf(i), what: whatOf(i), db_status: i.status });

  // 1. Open payments: ask Paystack how each one stands (newest first, a few at a time).
  const open = all.filter((i) => OPEN.includes(i.status) && now.getTime() - Date.parse(i.created_at) >= minAge).slice(0, maxChecks);
  let unreachable = 0;
  for (let n = 0; n < open.length; n += 5) {
    await Promise.all(open.slice(n, n + 5).map(async (i) => {
      const st = await provider.lookup(i.reference);
      if (st === null) { unreachable += 1; return; }
      const issue: Issue = st === "success" ? "paid_not_recorded" : st === "ongoing" || st === "pending" || st === "processing" || st === "queued" ? "waiting" : "unpaid";
      out.push({ ...base(i), paystack: st, issue, can_settle: issue === "paid_not_recorded" });
    }));
  }

  // 2. Paid and credited: was the thing bought actually granted?
  const paid = all.filter((i) => i.status === "successful" && i.credited_tx_id);
  const mkRefs = paid.filter((i) => purposeOf(i) === "marketplace").map((i) => i.reference), subRefs = paid.filter((i) => purposeOf(i) === "subscription").map((i) => i.reference);
  const have = new Set<string>();
  if (mkRefs.length) ((await admin.from("mk_purchases").select("payment_reference").in("payment_reference", mkRefs)).data as { payment_reference: string }[] | null)?.forEach((r) => have.add(r.payment_reference));
  if (subRefs.length) ((await admin.from("learner_subscriptions").select("source_ref").eq("source", "payment").in("source_ref", subRefs)).data as { source_ref: string }[] | null)?.forEach((r) => have.add(r.source_ref));
  for (const i of paid) if ((mkRefs.includes(i.reference) || subRefs.includes(i.reference)) && !have.has(i.reference)) out.push({ ...base(i), paystack: "success", issue: "paid_not_delivered", can_settle: true });

  // Who the buyer is (one lookup for the rows we show).
  const ids = [...new Set(all.filter((i) => out.some((o) => o.reference === i.reference)).map((i) => i.beneficiary_user_id))];
  if (ids.length) ((await admin.from("profiles").select("id, email").in("id", ids)).data as { id: string; email: string }[] | null)?.forEach((p) => emails.set(p.id, p.email));
  const owner = new Map(all.map((i) => [i.reference, i.beneficiary_user_id]));
  const rows = out.map((o) => ({ ...o, buyer_email: emails.get(owner.get(o.reference) ?? "") ?? null })).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { rows, checked: open.length, unreachable, since };
}

// Settles one payment: records it if Paystack says it succeeded, then grants what was bought. Idempotent. The action is written to the audit log.
export async function settlePayment(admin: SupabaseClient, secretKey: string, staffId: string, reference: string, fetchImpl?: typeof fetch): Promise<{ state: "confirmed" | "pending" | "failed" | "unknown"; error?: string }> {
  const result = await confirmPayment(admin, secretKey, staffId, reference, fetchImpl, true);
  await admin.from("audit_logs").insert({ actor_user_id: staffId, action: "payment.settle_manual", entity_type: "payment_intents", status: result.state === "confirmed" ? "pass" : "fail", details: { reference, result: result.state, error: result.error ?? null } });
  return result;
}
