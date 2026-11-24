// The numbers behind sharing an exam by link: what places cost, what is still to pay, and the link people open. The database is the one that charges and counts.
export const PLACE_TIERS = [10, 20, 50, 100, 200, 500, 1000] as const;
export const MIN_TOPUP = 5;                                       // the smallest online payment, in Coins
// Coins to pay to reach `total` places when `alreadyPaid` Coins have been paid: only the difference.
export const linkCost = (total: number, alreadyPaid: number, perPlace = 1): number => Math.max(0, Math.ceil(total * perPlace) - alreadyPaid);
export const shortfall = (cost: number, balance: number): number => Math.max(0, cost - balance);
export const topupAmount = (missing: number): number => (missing <= 0 ? 0 : Math.max(MIN_TOPUP, missing));
export const linkUrl = (origin: string, code: string): string => `${origin.replace(/\/$/, "")}/mock-exams/join/${code}`;
