import type { LoadPayload, LoadRowPayload, LoadTopic } from "./payload";

// Safe, resumable loading. A large file is sent in small requests. The database counts the rows it has taken (question_load_batches.rows_total), and that count, not
// anything held in the browser, decides where to continue, so a request that timed out after the database finished is never sent twice.
export const CALL_ROWS = 250;     // rows per request (the database accepts up to 500; smaller requests finish well inside the time limit)
export const CALL_TOPICS = 100;   // topics per request (the database limit)

// The next request: rows from `from`, at most `size` rows and `maxTopics` distinct topics, carrying exactly the topics those rows use.
export function sliceCall(payload: LoadPayload, from: number, size = CALL_ROWS, maxTopics = CALL_TOPICS): { topics: LoadTopic[]; rows: LoadRowPayload[] } {
  const rows: LoadRowPayload[] = [], keys = new Set<string>();
  for (let i = Math.max(0, from); i < payload.rows.length && rows.length < size; i++) {
    const r = payload.rows[i];
    if (!keys.has(r.topic_key) && keys.size >= maxTopics) break;
    keys.add(r.topic_key); rows.push(r);
  }
  return { topics: payload.topics.filter((t) => keys.has(t.key)), rows };
}

type Failure = { code?: unknown; status?: unknown; message?: unknown; details?: unknown } | null | undefined;
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// A failure worth trying again: a time-out, a dropped connection or a gateway hiccup. A rule the database refused (a QB_ code, a validation error) is not.
export function isTransientFailure(error: Failure): boolean {
  if (!error) return false;
  const code = text(error.code), status = Number(error.status), message = text(error.message);
  if (/^QB_/.test(message) || /^(22|23|42|P0)/.test(code)) return false;
  if (code === "57014" || code === "40001" || code === "40P01" || code === "53300") return true;
  if (status === 0 || [408, 429, 502, 503, 504].includes(status)) return true;
  return /statement timeout|canceling statement|timed out|timeout|failed to fetch|fetch failed|network|load failed|bad gateway|gateway|temporarily unavailable|connection (reset|closed|terminated)/i.test(message);
}

// What the admin sees when a load stops: the friendly sentence, WHERE it stopped, and the technical reason, so a failure can be reported and understood.
export function describeLoadFailure(friendly: string, error: Failure, where: { fromRow: number; toRow: number; total: number }): string {
  const tech = [text(error?.code) || (error?.status !== undefined ? `HTTP ${text(error.status)}` : ""), text(error?.message).slice(0, 160)].filter(Boolean).join(" · ");
  return `${friendly} The load stopped at questions ${where.fromRow + 1} to ${where.toRow} of ${where.total}; ${where.fromRow} before that were saved. Choose the same file again to continue from there.${tech ? ` (Technical detail: ${tech})` : ""}`;
}

// Where an interrupted batch should continue: the database's own count of rows it took, kept inside the file.
export const continueFrom = (rowsTaken: number | null | undefined, totalRows: number): number => Math.min(Math.max(0, Math.floor(Number(rowsTaken) || 0)), totalRows);

export type BatchState = { id: string; status: string; rows_total: number };
// Whether a batch the loader is told about can be continued with this file.
export const canContinue = (b: BatchState | null | undefined, totalRows: number): boolean => Boolean(b) && b!.status === "LOADING" && b!.rows_total > 0 && b!.rows_total < totalRows;
export const alreadyLoaded = (b: BatchState | null | undefined, totalRows: number): boolean => Boolean(b) && !canContinue(b, totalRows);
