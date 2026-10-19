// Browser-safe copy of the name parsing the teacher's screen needs (the server route validates again with the same pattern).
export const NAME_PATTERN = /^[A-Za-z][A-Za-z' -]{1,39}$/;
export type ParsedNames = { names: string[]; rejected: string[] };
export function parseNamesBrowser(text: string, max = 60): ParsedNames {
  const out: ParsedNames = { names: [], rejected: [] };
  for (const raw of text.split(/[\n,;]+/)) {
    const n = raw.trim().replace(/\s+/g, " ");
    if (!n) continue;
    (NAME_PATTERN.test(n) ? out.names : out.rejected).push(n);
  }
  if (out.names.length > max) { out.rejected.push(...out.names.slice(max)); out.names = out.names.slice(0, max); }
  return out;
}
