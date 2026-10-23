// Ready-made date ranges for the export screen. Days are UTC calendar days (the same clock the exported times use); both ends are included.
export type Preset = { id: string; label: string; range: (today: Date) => { from: string; to: string } | { from: null; to: null } };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const addDays = (d: Date, n: number) => utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);

export const PRESETS: Preset[] = [
  { id: "today", label: "Today", range: (t) => ({ from: iso(t), to: iso(t) }) },
  { id: "7d", label: "Last 7 days", range: (t) => ({ from: iso(addDays(t, -6)), to: iso(t) }) },
  { id: "30d", label: "Last 30 days", range: (t) => ({ from: iso(addDays(t, -29)), to: iso(t) }) },
  { id: "month", label: "This month", range: (t) => ({ from: iso(utc(t.getUTCFullYear(), t.getUTCMonth(), 1)), to: iso(t) }) },
  { id: "last-month", label: "Last month", range: (t) => ({ from: iso(utc(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)), to: iso(utc(t.getUTCFullYear(), t.getUTCMonth(), 0)) }) },
  { id: "quarter", label: "This quarter", range: (t) => ({ from: iso(utc(t.getUTCFullYear(), Math.floor(t.getUTCMonth() / 3) * 3, 1)), to: iso(t) }) },
  { id: "ytd", label: "This year", range: (t) => ({ from: iso(utc(t.getUTCFullYear(), 0, 1)), to: iso(t) }) },
  { id: "12m", label: "Last 12 months", range: (t) => ({ from: iso(addDays(utc(t.getUTCFullYear() - 1, t.getUTCMonth(), t.getUTCDate()), 1)), to: iso(t) }) },
  { id: "all", label: "All time", range: () => ({ from: null, to: null }) },
];
