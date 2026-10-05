import type { SupabaseClient } from "@supabase/supabase-js";

// Provider-neutral payment contract. Server-side only (uses the service-role client).
// Flow: intent (client RPC) -> provider -> webhook -> provider.verifyWebhook -> applyVerifiedPaymentEvent -> ledger credit.
// A frontend redirect is never an input to settlement.
export type PaymentStatus =
  | "initiated" | "pending" | "awaiting_approval" | "processing" | "successful" | "failed" | "cancelled" | "expired" | "reversed" | "refunded";
export type PaymentMethod = "mobile_money" | "card" | "bank_transfer";

export interface VerifiedPaymentEvent {
  provider: string;
  eventId: string; // provider-unique; used for replay protection
  reference: string; // our payment_intents.reference
  status: PaymentStatus;
  providerReference?: string;
  amountMinor: number;
  currency: string;
  payload?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly code: string;
  // Must authenticate the callback (signature and/or server-to-server re-query) and return null if it cannot be trusted.
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedPaymentEvent | null>;
}

const registry = new Map<string, PaymentProvider>();
export const registerPaymentProvider = (provider: PaymentProvider) => { registry.set(provider.code, provider); };
export const getPaymentProvider = (code: string) => registry.get(code) ?? null;

export const coinsToMinor = (coins: number, unitPriceMinor: number) => {
  if (!Number.isSafeInteger(coins) || coins <= 0 || !Number.isSafeInteger(unitPriceMinor) || unitPriceMinor <= 0) throw new Error("QB_INVALID_AMOUNT");
  return coins * unitPriceMinor;
};

export async function applyVerifiedPaymentEvent(admin: SupabaseClient, event: VerifiedPaymentEvent): Promise<{ outcome: string }> {
  const { data, error } = await admin.rpc("qb_payment_apply_event", {
    p_provider: event.provider, p_event_id: event.eventId, p_reference: event.reference, p_status: event.status,
    p_provider_reference: event.providerReference ?? null, p_amount_minor: event.amountMinor, p_currency: event.currency,
    p_verified: true, p_payload: event.payload ?? {},
  });
  if (error) throw new Error(error.message);
  return data as { outcome: string };
}

// Webhook entry point for a route handler: raw body in, safe HTTP status out. Unverifiable calls change nothing.
export async function handlePaymentWebhook(admin: SupabaseClient, providerCode: string, rawBody: string, headers: Headers): Promise<{ status: number; outcome?: string }> {
  const provider = getPaymentProvider(providerCode);
  if (!provider) return { status: 404 };
  const event = await provider.verifyWebhook(rawBody, headers).catch(() => null);
  if (!event || event.provider !== providerCode) return { status: 400 };
  return { status: 200, outcome: (await applyVerifiedPaymentEvent(admin, event)).outcome };
}

// Server-only Coin spend primitive (service-role client). The caller supplies the price and the order reference;
// the ledger guarantees atomicity, idempotency (same key => same result) and no negative balances.
export async function spendCoins(admin: SupabaseClient, input: { userId: string; amount: number; purpose: string; orderRef: string; idempotencyKey: string; entitlement?: { kind: string; validUntil?: string; metadata?: Record<string, unknown> } }) {
  const { data, error } = await admin.rpc("qb_coin_spend", {
    p_user: input.userId, p_amount: input.amount, p_purpose: input.purpose, p_ref: input.orderRef, p_idem: input.idempotencyKey,
    p_entitlement: input.entitlement ? { kind: input.entitlement.kind, valid_until: input.entitlement.validUntil ?? null, metadata: input.entitlement.metadata ?? {} } : null,
  });
  if (error) throw new Error(error.message);
  return data as { spent: number; split?: { promotional?: number; purchased?: number }; duplicate: boolean; entitlement_id: string | null };
}
