// Reads and checks an export request from the browser. Dates arrive as plain days (YYYY-MM-DD, both ends included); the database takes a half-open range, so the end day becomes the start of the next day.
export type ExportRequest = { dataset: string; from: string | null; to: string | null; category: string | null; format: "csv" | "xlsx" | "json" };
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isRealDay = (s: string): boolean => {
  const m = DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2020 && +m[1] <= 2100;
};
export const dayStart = (s: string) => `${s}T00:00:00Z`;
export const nextDayStart = (s: string) => new Date(Date.parse(dayStart(s)) + 86400000).toISOString().replace(".000Z", "Z");

export function parseExportRequest(body: unknown): { ok: true; value: ExportRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const dataset = typeof b.dataset === "string" ? b.dataset : "";
  if (!/^[a-z_]{3,40}$/.test(dataset)) return { ok: false, error: "Choose what to export." };
  const day = (v: unknown) => (v === undefined || v === null || v === "" ? null : typeof v === "string" && isRealDay(v) ? v : undefined);
  const from = day(b.from), to = day(b.to);
  if (from === undefined || to === undefined) return { ok: false, error: "Use dates like 2026-10-23." };
  if (from && to && to < from) return { ok: false, error: "The end date must not be before the start date." };
  const category = typeof b.category === "string" && b.category.trim() ? b.category.trim().slice(0, 60) : null;
  const format = b.format === "xlsx" || b.format === "json" ? b.format : "csv";
  return { ok: true, value: { dataset, from, to, category, format } };
}
