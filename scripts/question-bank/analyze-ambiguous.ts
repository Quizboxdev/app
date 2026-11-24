import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readQuestionFile } from "../../lib/question-loading/read";
import { buildIndex, keyOf, parseVerifiedCsv, resolveIndicator } from "../../lib/curriculum/verified";

// Usage: npx tsx scripts/question-bank/analyze-ambiguous.ts <folder> <out.csv> --curriculum a.csv,b.csv
// READ-ONLY. For every question the loader cannot place because one indicator code belongs to several indicators (AMBIGUOUS_INDICATOR),
// tests whether the question's own topic wording picks exactly one of them. Says how many rows a wording-based tie-break would rescue.
const args = process.argv.slice(2);
const folder = args[0], out = args[1], cur = args[args.indexOf("--curriculum") + 1];
async function walk(d: string): Promise<string[]> { const r: string[] = []; for (const e of await readdir(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) r.push(...await walk(p)); else if (/\.csv$/i.test(e.name)) r.push(p); } return r.sort(); }
const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
(async () => {
  const ind = []; for (const f of cur.split(",")) ind.push(...parseVerifiedCsv(await readFile(f, "utf8")));
  const index = buildIndex(ind);
  const total = { rows: 0, ambiguous: 0, rescued: 0, still: 0, unknown: 0 };
  const lines = ["file,subject,grade,indicator_code,rows_ambiguous,rescued_by_topic_wording,still_ambiguous,candidates"];
  for (const f of await walk(folder)) {
    let parsed; try { parsed = await readQuestionFile(f.split(/[\\/]/).pop() as string, new Uint8Array(await readFile(f))); } catch { continue; }
    const groups = new Map<string, { subject: string; grade: string; code: string; amb: number; ok: number; cand: number }>();
    for (const r of parsed.rows) {
      total.rows++;
      const res = resolveIndicator(index, r);
      if (res.status === "UNKNOWN_INDICATOR" || res.status === "UNKNOWN_GRADE" || res.status === "UNKNOWN_SUBJECT") { total.unknown++; continue; }
      if (res.status !== "AMBIGUOUS_INDICATOR") continue;
      total.ambiguous++;
      const t = keyOf(r.topic);
      const hits = res.candidates.filter((c) => { const w = keyOf(c.indicator); return t && w && (w === t || w.startsWith(t) || t.startsWith(w)); });
      const one = new Set(hits.map((h) => `${h.content_standard_code}|${keyOf(h.indicator)}`)).size === 1;
      const k = `${r.subject}|${r.grade}|${r.indicator_code}`;
      const g = groups.get(k) ?? { subject: r.subject, grade: r.grade, code: r.indicator_code, amb: 0, ok: 0, cand: res.candidates.length };
      g.amb++; if (one) { g.ok++; total.rescued++; } else total.still++;
      groups.set(k, g);
    }
    for (const g of groups.values()) lines.push([q(f.split(/[\\/]/).pop() as string), q(g.subject), q(g.grade), q(g.code), g.amb, g.ok, g.amb - g.ok, g.cand].join(","));
  }
  await writeFile(out, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
  console.log(JSON.stringify(total));
})();
