// How long an attempt took, in milliseconds, from whichever timing fields the result carries. Returns null when none is usable, so the page can leave the line out instead of guessing.
type Timing = { duration_ms?: unknown; duration_seconds?: unknown; time_spent_seconds?: unknown; time_taken_seconds?: unknown; started_at?: unknown; submitted_at?: unknown };

const positive = (value: unknown): number | null => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };

export function attemptDurationMs(result: Timing | null | undefined): number | null {
  if (!result) return null;
  const ms = positive(result.duration_ms);
  if (ms) return ms;
  const seconds = positive(result.time_spent_seconds) ?? positive(result.time_taken_seconds) ?? positive(result.duration_seconds);
  if (seconds) return seconds * 1000;
  const start = Date.parse(String(result.started_at ?? "")), end = Date.parse(String(result.submitted_at ?? ""));
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
}

export function durationText(ms: number): string {
  const total = Math.round(ms / 1000), minutes = Math.floor(total / 60), seconds = total % 60;
  return minutes === 0 ? `${seconds} sec` : seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} sec`;
}
