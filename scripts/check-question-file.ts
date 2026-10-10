import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { checkRows } from "../lib/question-loading/check";
import { readQuestionFile } from "../lib/question-loading/read";

// Usage: npx tsx scripts/check-question-file.ts <file.xlsx|file.csv> [--scope curriculum|sponsor] [--problems problems.csv]
// Read-only: checks a question-loading file against the template rules and prints a report. Nothing is sent anywhere.
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--scope" && args[args.indexOf(a) - 1] !== "--problems");
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error("Usage: tsx scripts/check-question-file.ts <file.xlsx|file.csv> [--scope curriculum|sponsor] [--problems out.csv]"); process.exit(2); }
const path: string = file;
const scope = option("--scope")?.toUpperCase() === "SPONSOR" ? "SPONSOR" : "CURRICULUM";

async function main() {
  const parsed = await readQuestionFile(basename(path), new Uint8Array(await readFile(path)));
  const report = checkRows(parsed.rows, scope, parsed.fileRows);
  const top = (counts: Record<string, number>, n = 8) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}: ${v}`).join(" | ");

  console.log(`File: ${basename(path)}${parsed.sheet ? ` (sheet ${parsed.sheet})` : ""}   Scope: ${scope}`);
  if (parsed.unknownColumns.length) console.log(`Ignored columns: ${parsed.unknownColumns.join(", ")}`);
  console.log(`Rows: ${report.rows}   clean: ${report.cleanRows}   with warnings only: ${report.warningRows}   with errors: ${report.errorRows}`);
  console.log(`Level: ${top(report.counts.level)}\nGrade: ${top(report.counts.grade)}\nSubject: ${top(report.counts.subject)}\nDifficulty: ${top(report.counts.difficulty)}\nCognitive: ${top(report.counts.cognitive)}\nAnswer type: ${top(report.counts.answerType)}\nCorrect letters: ${top(report.counts.correct)}\nIndicators/topics: ${Object.keys(report.counts.indicator).length}`);
  if (report.batchFlags.length) { console.log("\nBatch flags:"); for (const f of report.batchFlags) console.log(`  [${f.severity.toUpperCase()}] ${f.code}: ${f.detail}`); }
  const byCode = report.issues.reduce<Record<string, number>>((acc, i) => { const k = `${i.severity === "error" ? "ERROR" : "warn "} ${i.code}`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  if (Object.keys(byCode).length) { console.log("\nProblems by type:"); for (const [k, v] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`); }
  console.log(`\nCan load: ${report.canLoad ? "YES" : "NO (fix the errors and batch flags marked ERROR first)"}`);
  const problems = option("--problems");
  if (problems) {
    await writeFile(problems, "﻿row,severity,code,field\r\n" + report.issues.map((i) => [i.row, i.severity, i.code, i.field ?? ""].join(",")).join("\r\n") + "\r\n", "utf8");
    console.log(`Problem list written to ${problems}`);
  }
  process.exitCode = report.canLoad ? 0 : 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 2; });
