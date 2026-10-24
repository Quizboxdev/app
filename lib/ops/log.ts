// One place for "this fell back to a safe default, but here is why" log lines (audit QB-AUD-012). It writes a short, single line: the area, what happened and the error's name and message (cut short).
// Never pass a request body, a header or a key: only the error itself. The line appears in the Vercel function logs, searchable by the [area] tag.
export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.replace(/\s+/g, " ").slice(0, 200);
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message).replace(/\s+/g, " ").slice(0, 200);
  return "unknown error";
}
export const logFallback = (area: string, what: string, e: unknown) => console.error(`[${area}] ${what}: ${describeError(e)}`);
