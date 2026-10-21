import plansFile from "../../config/subscription-plans.json";

// Plans come from config/subscription-plans.json (owner-editable). A plan is sold online only when it names its Coins and days; the cedi price is
// Coins times the unit price the owner sets (Admin, Access and Subscriptions), so prices live in one place and a plan file never holds a price.
export type Plan = { id: string; name: string; audience: string; period: string; price: number | null; includes: string[]; coins?: number; days?: number };
export const PLANS = plansFile.plans as Plan[];
export const findPlan = (id: string): Plan | undefined => PLANS.find((p) => p.id === id);
export const isOnlinePlan = (p: Plan | undefined): p is Plan & { coins: number; days: number } =>
  !!p && Number.isSafeInteger(p.coins) && (p.coins ?? 0) > 0 && Number.isSafeInteger(p.days) && (p.days ?? 0) > 0;
// Price in minor units (pesewas) from the unit price per Coin; null when payments are not priced yet.
export const planPriceMinor = (p: Plan, unitMinor: number | null | undefined): number | null =>
  isOnlinePlan(p) && unitMinor && unitMinor > 0 ? p.coins * unitMinor : null;

// A plan the checkout can sell: Coins and days. It comes from the admin price list (code plan_weekly, plan_monthly, ...) or, for older links, from the plan file.
// The price is never taken from here: the route computes it as Coins x the unit price held in the database.
export type SellablePlan = { id: string; coins: number; days: number };
type PriceRowLike = { code?: unknown; audience?: unknown; coins?: unknown; days?: unknown };
export function resolveSellablePlan(id: string, rows: unknown): SellablePlan | undefined {
  const list = Array.isArray(rows) ? (rows as PriceRowLike[]) : [];
  const row = list.find((r) => r.code === id && r.audience === "learner");
  if (row && Number.isSafeInteger(row.coins) && (row.coins as number) > 0 && Number.isSafeInteger(row.days) && (row.days as number) > 0) return { id, coins: row.coins as number, days: row.days as number };
  const old = findPlan(id);
  return isOnlinePlan(old) ? { id: old.id, coins: old.coins, days: old.days } : undefined;
}
