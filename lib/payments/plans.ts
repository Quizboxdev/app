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
