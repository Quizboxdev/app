import type { SupabaseClient } from "@supabase/supabase-js";
import { applyVerifiedPaymentEvent } from "@/lib/core/payments";
import { createPaystackProvider } from "./paystack";
import { fulfilAfter } from "./settlement";

// A safety net for the webhook. When a buyer comes back from Paystack, we ask Paystack directly (server to server, with our secret key) how the payment ended, and settle it the same way the webhook would.
// The browser's say-so is never used: only Paystack's own answer counts, only for a payment that belongs to the caller, and the event id is the webhook's, so whichever arrives first settles it and the other is a harmless duplicate.
export type ConfirmState = "confirmed" | "pending" | "failed" | "unknown";
export async function confirmPayment(admin: SupabaseClient, secretKey: string, userId: string, reference: string, fetchImpl?: typeof fetch, staff = false): Promise<{ state: ConfirmState; error?: string }> {
  if (!/^QB-[A-Za-z0-9]{8,64}$/.test(reference)) return { state: "unknown" };
  const { data: intent } = await admin.from("payment_intents").select("payer_user_id, beneficiary_user_id, status").eq("reference", reference).maybeSingle();
  const row = intent as { payer_user_id: string; beneficiary_user_id: string; status: string } | null;
  if (!row || (!staff && row.payer_user_id !== userId && row.beneficiary_user_id !== userId)) return { state: "unknown" };          // someone else's payment looks the same as none (finance staff, checked by the caller, may settle any)
  if (row.status === "successful") {
    const done = await fulfilAfter(admin, "already_settled", reference);               // settled already (webhook first): make sure the purchase was recorded too
    return done.ok ? { state: "confirmed" } : { state: "pending", error: done.failure };
  }
  if (["reversed", "refunded", "failed", "cancelled", "expired"].includes(row.status)) return { state: "failed" };
  let result: Awaited<ReturnType<ReturnType<typeof createPaystackProvider>["confirm"]>>;
  try { result = await createPaystackProvider(secretKey, fetchImpl).confirm(reference); } catch { return { state: "pending" }; }
  if (result === null) return { state: "failed" };
  if ("pending" in result) return { state: "pending" };
  const applied = await applyVerifiedPaymentEvent(admin, result).catch(() => null);
  if (!applied) return { state: "pending", error: "apply_failed" };
  const done = await fulfilAfter(admin, applied.outcome, reference);
  return done.ok ? { state: applied.outcome === "amount_mismatch" ? "failed" : "confirmed" } : { state: "pending", error: done.failure };
}
