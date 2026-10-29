// Compares the result tables of the database fingerprint (docs/release/db_fingerprint_A.sql and _B.sql) from the two Supabase projects, and writes the dated
// line for docs/release/FINGERPRINT_HISTORY.md. Used by scripts/release/compare-fingerprints.ts. Pure text in, text out: it never touches a database.
export type FingerprintRow = { version: string; checks: number; found: number; status: string; missing: string };
export type Comparison = {
  production: Record<string, string>;
  preview: Record<string, string>;
  differences: { version: string; production: string; preview: string }[];
  problems: { project: "production" | "preview"; version: string; status: string; missing: string }[];
  identical: boolean;
  versions: number;
};

// Accepts the markdown table Supabase gives when you copy a result, one or more tables in the same text.
export function parseFingerprint(text: string): FingerprintRow[] {
  const rows: FingerprintRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    if (cells.length < 4 || !/^\d{14}$/.test(cells[0])) continue;
    rows.push({ version: cells[0], checks: Number(cells[1]), found: Number(cells[2]), status: cells[3], missing: cells[4] ?? "" });
  }
  return rows;
}

const byVersion = (rows: FingerprintRow[]) => Object.fromEntries(rows.map((r) => [r.version, r]));

export function compareFingerprints(production: FingerprintRow[], preview: FingerprintRow[]): Comparison {
  const p = byVersion(production), v = byVersion(preview);
  const versions = [...new Set([...Object.keys(p), ...Object.keys(v)])].sort();
  const differences = versions
    .filter((x) => (p[x]?.status ?? "absent") !== (v[x]?.status ?? "absent"))
    .map((x) => ({ version: x, production: p[x]?.status ?? "absent", preview: v[x]?.status ?? "absent" }));
  const problems: Comparison["problems"] = [];
  for (const [project, map] of [["production", p], ["preview", v]] as const) {
    for (const x of versions) {
      const r = map[x];
      if (r && r.status !== "ok") problems.push({ project, version: x, status: r.status, missing: r.missing });
    }
  }
  return {
    production: Object.fromEntries(versions.map((x) => [x, p[x]?.status ?? "absent"])),
    preview: Object.fromEntries(versions.map((x) => [x, v[x]?.status ?? "absent"])),
    differences,
    problems,
    identical: differences.length === 0 && problems.length === 0 && versions.length > 0,
    versions: versions.length,
  };
}

const count = (m: Record<string, string>, s: string) => Object.values(m).filter((x) => x === s).length;

// One readable report for the screen.
export function formatComparison(c: Comparison): string {
  const lines = [
    `Migrations compared: ${c.versions}`,
    `Production: ${count(c.production, "ok")} ok, ${count(c.production, "PARTIAL")} PARTIAL, ${count(c.production, "MISSING")} MISSING`,
    `Preview:    ${count(c.preview, "ok")} ok, ${count(c.preview, "PARTIAL")} PARTIAL, ${count(c.preview, "MISSING")} MISSING`,
  ];
  if (c.identical) {
    lines.push("", "RESULT: IDENTICAL. Every migration is ok on both projects.");
  } else {
    lines.push("", "RESULT: NOT IDENTICAL");
    for (const d of c.differences) lines.push(`  ${d.version}: Production ${d.production}, Preview ${d.preview}`);
    for (const x of c.problems.filter((x) => !c.differences.some((d) => d.version === x.version))) lines.push(`  ${x.version}: ${x.project} ${x.status} (${x.missing || "no detail"}), same on both`);
  }
  return lines.join("\n");
}

// The line to add to docs/release/FINGERPRINT_HISTORY.md.
export function historyLine(c: Comparison, date: string, note = ""): string {
  const side = (m: Record<string, string>) => `${count(m, "ok")}/${c.versions} ok`;
  return `| ${date} | ${side(c.production)} | ${side(c.preview)} | ${c.identical ? "identical" : `${c.differences.length + c.problems.length} to fix`} | ${note.replace(/\|/g, "/")} |`;
}
