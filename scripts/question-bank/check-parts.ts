import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { readQuestionFile } from "../../lib/question-loading/read";
import { buildPlan } from "../../lib/question-loading/plan";
import { buildIndex, parseVerifiedCsv } from "../../lib/curriculum/verified";

// Usage: npx tsx scripts/question-bank/check-parts.ts <folder> <out.csv> [--curriculum a.csv,b.csv,c.csv]
// READ-ONLY. Runs the loader's own checks (readQuestionFile, checkRows via buildPlan, indicator placement against the verified curriculum files) on every .csv under <folder>
// and writes one line per file: the verdict and every refusal code with its count. Nothing is sent anywhere.
const args = process.argv.slice(2);
const folder = args[0], out = args[1];
const curArg = args.indexOf("--curriculum") >= 0 ? args[args.indexOf("--curriculum") + 1] : "";
const onlyArg = args.indexOf("--only") >= 0 ? args[args.indexOf("--only") + 1] : "";   // optional regular expression: only files whose path matches
if (!folder || !out || !curArg) { console.error("Usage: tsx scripts/question-bank/check-parts.ts <folder> <out.csv> --curriculum a.csv,b.csv"); process.exit(2); }

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) found.push(...await walk(p));
    else if (/\.csv$/i.test(e.name)) found.push(p);
  }
  return found.sort();
}
const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;

async function main() {
  const indicators = [];
  for (const f of curArg.split(",")) indicators.push(...parseVerifiedCsv(await readFile(f, "utf8")));
  const index = buildIndex(indicators);
  const files = (await walk(folder)).filter((f) => !onlyArg || new RegExp(onlyArg, "i").test(f));
  const lines = ["file,rows,verdict,topics,error_rows,warning_rows,refusals,top_error_codes,batch_flags"];
  let ok = 0, bad = 0;
  for (const f of files) {
    const name = relative(folder, f);
    try {
      const bytes = new Uint8Array(await readFile(f));
      const parsed = await readQuestionFile(f.split(/[\\/]/).pop() as string, bytes);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const plan = buildPlan({ rows: parsed.rows, fileRows: parsed.fileRows, fileSha256: hash, scope: "CURRICULUM", index });
      const codes = new Map<string, number>();
      for (const i of plan.report.issues) if (i.severity === "error") codes.set(i.code, (codes.get(i.code) ?? 0) + 1);
      const top = [...codes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) => `${c}=${n}`).join("; ");
      const flags = plan.report.batchFlags.map((x) => `${x.severity}:${x.code}`).join("; ");
      if (plan.canLoad) ok++; else bad++;
      lines.push([q(name), parsed.rows.length, plan.canLoad ? "READY" : "REFUSED", plan.topics.length, plan.report.errorRows, plan.report.warningRows, q(plan.blockers.join("; ")), q(top), q(flags)].join(","));
    } catch (e) { bad++; lines.push([q(name), 0, "UNREADABLE", 0, 0, 0, q((e as Error).message.slice(0, 160)), q(""), q("")].join(",")); }
  }
  await writeFile(out, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
  console.log(`${files.length} files: ${ok} READY, ${bad} refused/unreadable. Written to ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
