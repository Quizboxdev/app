// Reads the "[csp]" lines the collector (app/api/ops/csp-report) writes to the Vercel logs and says whether the Content-Security-Policy is ready to enforce.
// Used by scripts/ops/csp-triage.ts: export the log lines from Vercel (Logs, search "[csp]"), save them to a text file, run the script on it.
export type CspLine = { mode: string; directive: string; blocked: string; page: string };
export type CspGroup = { directive: string; blocked: string; count: number; pages: string[] };
export type CspTriage = { total: number; groups: CspGroup[]; verdict: "CLEAN" | "REVIEW" };

const LINE = /\[csp\]\s+(\S+)\s+directive=(\S+)\s+blocked=(\S*)\s+page=(\S*)/;

export function parseCspLines(text: string): CspLine[] {
  const out: CspLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (m) out.push({ mode: m[1], directive: m[2], blocked: m[3] || "(empty)", page: m[4] || "/" });
  }
  return out;
}

export function triageCsp(lines: CspLine[]): CspTriage {
  const byKey = new Map<string, CspGroup & { pageSet: Set<string> }>();
  for (const l of lines) {
    const key = `${l.directive}|${l.blocked}`;
    const g = byKey.get(key) ?? { directive: l.directive, blocked: l.blocked, count: 0, pages: [], pageSet: new Set<string>() };
    g.count += 1; g.pageSet.add(l.page); byKey.set(key, g);
  }
  const groups = [...byKey.values()].map(({ pageSet, ...g }) => ({ ...g, pages: [...pageSet].sort().slice(0, 5) })).sort((a, b) => b.count - a.count);
  return { total: lines.length, groups, verdict: lines.length === 0 ? "CLEAN" : "REVIEW" };
}

export function formatCspTriage(t: CspTriage): string {
  if (t.verdict === "CLEAN") return "CLEAN: no violation lines in this log. If it covers at least 7 days including school hours, the policy can be enforced (docs/ops/CSP_ENFORCEMENT.md).";
  const rows = t.groups.map((g) => `${String(g.count).padStart(5)}  ${g.directive.padEnd(14)} blocked=${g.blocked}  on ${g.pages.join(", ")}`);
  return [`REVIEW: ${t.total} violation line(s) in ${t.groups.length} group(s). Explain each group before enforcing:`, ...rows,
    "", "For each group: if it is a real part of QuizBox (a script, image, font or connection we use), add its origin to lib/security/headers.ts and re-check. If it is one visitor's tool or a bot, it can be ignored.",
    "'eval' means a library needs unsafe-eval, which we do not allow: find and remove or replace it before enforcing."].join("\n");
}
