import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, VerifiedPaymentEvent } from "@/lib/core/payments";

// Paystack adapter (mobile money and cards in Ghana). Two independent checks before any money is credited: the webhook signature
// (HMAC-SHA512 of the raw body with the secret key), then a server-to-server re-query of the transaction that must agree on status, amount and
// currency. A browser redirect is never an input to settlement. Enabled only when PAYSTACK_SECRET_KEY is set on the server.
const API = "https://api.paystack.co";
type Fetch = typeof fetch;
export type InitializeInput = { email: string; amountMinor: number; currency: string; reference: string; callbackUrl: string; metadata?: Record<string, unknown> };
export type PaystackProvider = PaymentProvider & { initialize(i: InitializeInput): Promise<{ url: string; reference: string }>; confirm(reference: string): Promise<VerifiedPaymentEvent | { pending: true } | null> };

export function createPaystackProvider(secretKey: string, fetchImpl: Fetch = fetch): PaystackProvider {
  const auth = { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" };
  const signatureOk = (raw: string, given: string | null) => {
    if (!given || !/^[0-9a-f]{128}$/i.test(given)) return false;
    const want = createHmac("sha512", secretKey).update(raw).digest();
    const got = Buffer.from(given, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  };
  const requery = async (reference: string) => {
    const res = await fetchImpl(`${API}/transaction/verify/${encodeURIComponent(reference)}`, { headers: auth, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: boolean; data?: { id?: number; status?: string; amount?: number; currency?: string; reference?: string } };
    return body.status && body.data ? body.data : null;
  };
  return {
    code: "paystack",
    async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedPaymentEvent | null> {
      if (!signatureOk(rawBody, headers.get("x-paystack-signature"))) return null;
      const evt = JSON.parse(rawBody) as { event?: string; data?: Record<string, any> };
      const d = evt.data ?? {};
      if (evt.event === "charge.success") {
        const reference = String(d.reference ?? "");
        const live = await requery(reference);
        if (!live || live.status !== "success" || live.amount !== d.amount || live.currency !== d.currency) return null;       // the provider itself must confirm it
        return { provider: "paystack", eventId: `charge.success:${d.id}`, reference, status: "successful", providerReference: String(d.id), amountMinor: Number(live.amount), currency: String(live.currency) };
      }
      if (evt.event === "charge.failed" || evt.event === "charge.abandoned") {
        return { provider: "paystack", eventId: `${evt.event}:${d.id ?? d.reference}`, reference: String(d.reference ?? ""), status: "failed", providerReference: d.id ? String(d.id) : undefined, amountMinor: Number(d.amount ?? 0), currency: String(d.currency ?? "") };
      }
      if (evt.event === "refund.processed") {
        const reference = String(d.transaction_reference ?? d.transaction?.reference ?? "");
        return { provider: "paystack", eventId: `refund.processed:${d.id}`, reference, status: "refunded", amountMinor: Number(d.amount ?? 0), currency: String(d.currency ?? "") };
      }
      return null;                                                                                                              // other events change nothing
    },
    // Asks Paystack itself (server to server, with our secret key) how a payment ended, for a buyer who has just come back from paying. This does not depend on the webhook arriving.
    // The event id matches the webhook's, so whichever comes first settles it and the other is ignored as a duplicate.
    async confirm(reference: string) {
      const live = await requery(reference);
      if (!live) return null;
      if (live.status === "success" && live.id && live.reference === reference) return { provider: "paystack", eventId: `charge.success:${live.id}`, reference, status: "successful" as const, providerReference: String(live.id), amountMinor: Number(live.amount), currency: String(live.currency) };
      return live.status === "failed" || live.status === "abandoned" || live.status === "reversed" ? null : { pending: true as const };
    },
    async initialize(i: InitializeInput) {
      const res = await fetchImpl(`${API}/transaction/initialize`, { method: "POST", headers: auth, cache: "no-store",
        body: JSON.stringify({ email: i.email, amount: i.amountMinor, currency: i.currency, reference: i.reference, callback_url: i.callbackUrl, channels: ["mobile_money", "card"], metadata: i.metadata ?? {} }) });
      const body = (await res.json().catch(() => ({}))) as { status?: boolean; data?: { authorization_url?: string; reference?: string } };
      if (!res.ok || !body.status || !body.data?.authorization_url) throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
      return { url: body.data.authorization_url, reference: body.data.reference ?? i.reference };
    },
  };
}

// Registers the providers whose server secret is configured. Returns the provider codes now active.
export function registerConfiguredProviders(register: (p: PaymentProvider) => void): string[] {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return [];
  register(createPaystackProvider(key));
  return ["paystack"];
}
