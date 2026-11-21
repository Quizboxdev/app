// The sentences about prices that the public Pricing page and the in-app Subscribe page both show, so a visitor and a learner are never told two different things.
// A learner is told the truth about money in plain words: what is free, what costs, and that nothing is charged until they press pay.
export function pricingNote(anyPriced: boolean, paymentsOpen = true): string {
  if (anyPriced && paymentsOpen) return "Prices are in Ghana cedis. Nothing is charged until you press pay.";
  return "Some prices are still being finalised. Nothing is charged until a price is shown and you press pay.";
}

// Where the learner stands on the free practice sessions, or null when there is no limit to talk about.
export function freeAllowanceLine(a: { gated: boolean; free_limit: number | null; used: number; remaining: number | null; subscribed: boolean } | null | undefined): string | null {
  if (!a || a.subscribed || !a.gated || a.free_limit === null) return null;
  const left = a.remaining ?? Math.max(0, a.free_limit - a.used);
  if (left <= 0) return `You have used your ${a.free_limit} free practice session${a.free_limit === 1 ? "" : "s"}.`;
  return `You have ${left} of ${a.free_limit} free practice session${a.free_limit === 1 ? "" : "s"} left.`;
}
