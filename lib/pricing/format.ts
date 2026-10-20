// Shapes and wording for the price list (migration 20261030100000). Pure functions: used by the public pricing page, the in-app cards and the admin screen.
export type PriceAudience = "learner" | "teacher" | "school" | "host" | "sponsor" | "company" | "other";
export type PricePeriod = "month" | "term" | "year" | "campaign" | "once" | "free";
export type PriceRow = {
  code: string; kind: "plan" | "campaign" | "bundle" | "addon"; name: string; audience: PriceAudience; description: string; includes: string[]; period: PricePeriod;
  price_minor: number | null; currency: string; highlight: boolean; checkout_url: string | null;
  coins?: number | null; days?: number | null; levels?: string[];
};
export type PriceAdminRow = PriceRow & { id: string; active: boolean; starts_at: string | null; ends_at: string | null; sort_order: number };

export const AUDIENCE_LABEL: Record<PriceAudience, string> = { learner: "Learners", teacher: "Teachers", school: "Schools", host: "Quiz hosts", sponsor: "Sponsors", company: "Companies and brands", other: "Other" };
// Which heading each audience sits under on the pricing page.
export const SECTIONS: { id: string; title: string; lead: string; audiences: PriceAudience[] }[] = [
  { id: "learners", title: "For learners", lead: "Practise, join challenges and competitions, and read the material before you play.", audiences: ["learner"] },
  { id: "schools", title: "For teachers and schools", lead: "Run classes, set work and compete as a school.", audiences: ["teacher", "school"] },
  { id: "sponsors", title: "For sponsors and companies", lead: "Run a branded quiz on your own material and reach the audience you choose.", audiences: ["host", "sponsor", "company", "other"] },
];
export const PERIOD_LABEL: Record<PricePeriod, string> = { month: "per month", term: "per term", year: "per year", campaign: "per quiz", once: "one-off", free: "" };

// "Free", "GHS 25.00" and "Price to be announced": never a broken or zero-looking price.
export function priceLabel(row: Pick<PriceRow, "price_minor" | "currency" | "period">): { amount: string; per: string; announced: boolean } {
  if (row.price_minor === null || row.price_minor === undefined) return { amount: "Price to be announced", per: "", announced: true };
  if (row.price_minor === 0) return { amount: "Free", per: "", announced: false };
  const major = row.price_minor / 100;
  return { amount: `${row.currency} ${Number.isInteger(major) ? major.toFixed(0) : major.toFixed(2)}`, per: PERIOD_LABEL[row.period] ?? "", announced: false };
}
// Cedis typed by the admin (e.g. "25", "25.50", "") to pesewas; null for blank. Throws on anything else.
export function toMinor(input: string): number | null {
  const t = input.trim().replace(/,/g, "");
  if (t === "") return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) throw new Error("Enter the price in cedis, for example 25 or 25.50.");
  return Math.round(Number(t) * 100);
}
export const fromMinor = (minor: number | null | undefined): string => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2).replace(/\.00$/, ""));

export function groupPrices<T extends Pick<PriceRow, "audience">>(rows: T[]): { id: string; title: string; lead: string; rows: T[] }[] {
  return SECTIONS.map((s) => ({ id: s.id, title: s.title, lead: s.lead, rows: rows.filter((r) => s.audiences.includes(r.audience)) })).filter((g) => g.rows.length > 0);
}
