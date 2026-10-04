// Display formatters shared by internal screens. They never change stored values.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** First block of a UUID ("264e35df"), for compact reference columns. Other values pass through. */
export function shortId(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value);
  return isUuid(text) ? text.slice(0, 8) : text;
}

/** Shortens every UUID inside a longer string: "sponsor-candidate:d7e435bd-…" -> "sponsor-candidate:d7e435bd". */
export function shortenIds(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "$1");
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3 Oct 2026, 08:20" */
export function formatDateTime(value: unknown, fallback = "—"): string {
  const date = toDate(value);
  return date ? date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : fallback;
}

/** "3 Oct 2026" */
export function formatDate(value: unknown, fallback = "—"): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : fallback;
}

/** "TOP_UP_QUEUE" -> "Top up queue", "needs_revision" -> "Needs revision". */
export function humanize(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const text = String(value).replace(/[_-]+/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

/** Maps common workflow statuses to a badge tone. Unknown statuses are neutral. */
export function statusTone(value: unknown): StatusTone {
  const status = String(value ?? "").toLowerCase();
  if (/^(approved|active|published|completed|complete|final|passed|paid|verified|ready|resolved|success|succeeded|done)$/.test(status)) return "success";
  if (/^(failed|rejected|error|suspended|cancelled|canceled|blocked|expired|held)$/.test(status)) return "danger";
  if (/(pending|review|revision|draft|queued|processing|in_progress|configuring|submitted|open|assigned|scheduled|generating)/.test(status)) return "warning";
  return "neutral";
}
