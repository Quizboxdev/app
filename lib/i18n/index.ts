// Localization foundation. UI strings live in catalogs keyed by message id; English is the base for
// every locale until a translation is supplied. Locale and currency come from the user's market.
export type Locale = string;
const en: Record<string, string> = {
  "home.loading": "Loading your dashboard…", "home.empty": "Nothing here yet.", "home.error": "This section could not be loaded.",
  "notifications.title": "Notifications", "notifications.empty": "You are all caught up.", "notifications.markAll": "Mark all as read", "notifications.live": "Needs attention",
  "search.placeholder": "Search", "search.empty": "No results in your market.", "search.label": "Search QuizBox",
  "common.open": "Open", "common.retry": "Try again", "common.loading": "Loading…",
};
const catalogs: Record<string, Record<string, string>> = { en };
export function resolveLocale(candidates: Array<string | null | undefined>): Locale {
  for (const c of candidates) { if (!c) continue; try { return Intl.getCanonicalLocales(c)[0]; } catch { /* ignore invalid tags */ } }
  return "en";
}
export function t(key: string, locale: Locale = "en", vars: Record<string, string | number> = {}): string {
  const lang = locale.split("-")[0];
  const text = catalogs[locale]?.[key] ?? catalogs[lang]?.[key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
const safe = <T,>(fn: () => T, fallback: T) => { try { return fn(); } catch { return fallback; } };
export const formatDate = (value: string | Date | null | undefined, locale: Locale, timeZone?: string) =>
  value ? safe(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(value)), String(value)) : "";
export const formatDateTime = (value: string | Date | null | undefined, locale: Locale, timeZone?: string) =>
  value ? safe(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value)), String(value)) : "";
export const formatNumber = (value: number | string | null | undefined, locale: Locale, digits = 1) =>
  value === null || value === undefined || value === "" ? "-" : safe(() => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(Number(value)), String(value));
// Currency comes from the market or the record; never inferred and never converted.
export const formatCurrency = (value: number | string, currency: string, locale: Locale) =>
  safe(() => new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value)), `${currency} ${value}`);
