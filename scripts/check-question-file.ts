import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { checkRows } from "../lib/question-loading/check";
import { balanceAnswerKey } from "../lib/question-loading/balance";
import { verifySource, type SourcePage } from "../lib/question-loading/source";
import { LOAD_COLUMNS } from "../lib/question-loading/template";
import { readQuestionFile } from "../lib/question-loading/read";

// Usage: npx tsx scripts/check-question-file.ts <file.xlsx|file.csv|file.txt> [more files: batches are merged] [--scope curriculum|sponsor] [--problems problems.csv]
//        [--source document.pdf|document.txt]  verify quotes, pages and indicator codes against the source
//        [--topic-block 50]                    questions expected per topic (default 50)
//        [--rebalance balanced.csv]            write a copy with the correct-answer letters evened out
// Read-only: checks a question-loading file against the template rules and prints a report. Nothing is sent anywhere.
const args = process.argv.slice(2);
const VALUE_OPTIONS = ["--scope", "--problems", "--source", "--rebalance", "--topic-block"];
const files = args.filter((a, i) => !a.startsWith("--") && !VALUE_OPTIONS.includes(args[i - 1]));
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!files.length) { console.error("Usage: tsx scripts/check-question-file.ts <file.xlsx|file.csv|file.txt> [more files...] [--scope curriculum|sponsor] [--problems out.csv] [--source doc.pdf] [--rebalance out.csv]"); process.exit(2); }
const scope = option("--scope")?.toUpperCase() === "SPONSOR" ? "SPONSOR" : "CURRICULUM";

async function main() {
  const parts = [];
  for (const f of files) parts.push({ name: basename(f), parsed: await readQuestionFile(basename(f), new Uint8Array(await readFile(f))) });
  const single = parts.length === 1;
  const parsed = { rows: parts.flatMap((p) => p.parsed.rows), unknownColumns: [...new Set(parts.flatMap((p) => p.parsed.unknownColumns))], sheet: single ? parts[0].parsed.sheet : undefined, fileRows: [] as number[] };
  parsed.fileRows = single ? parts[0].parsed.fileRows : parsed.rows.map((_, i) => i + 1);
  if (!single) { let n = 0; for (const p of parts) { console.log(`${p.name}: combined rows ${n + 1}-${n + p.parsed.rows.length}${p.parsed.headerless ? " (no header row; template header assumed)" : ""}`); n += p.parsed.rows.length; } console.log(); }
  else if (parts[0].parsed.headerless) console.log("No header row found; the template header was assumed." + String.fromCharCode(10));
  const topicBlock = Number(option("--topic-block") ?? 50) || 50;
  const report = checkRows(parsed.rows, scope, parsed.fileRows, { topicBlock });
  const sourcePath = option("--source");
  if (sourcePath) {
    const pages: SourcePage[] = /\.pdf$/i.test(sourcePath)
      ? await (async () => { const { PDFParse } = await import("pdf-parse") as any; const parser = new PDFParse({ data: new Uint8Array(await readFile(sourcePath)) }); const result = await parser.getText(); await parser.destroy(); return result.pages.map((p: any) => ({ n: p.num, text: p.text })); })()
      : [{ n: 1, text: await readFile(sourcePath, "utf8") }];
    const checked = verifySource(parsed.rows, pages, scope, parsed.fileRows);
    report.issues.push(...checked.issues);
    const sm = checked.summary;
    console.log(`Source check (${pages.length} pages): quotes word-for-word ${sm.exact}, near ${sm.near}, not found ${sm.missing}, none given ${sm.noQuote}; page offset ${sm.pageOffset ?? "n/a"}, page mismatches ${sm.pageMismatch}; indicator codes found ${sm.indicatorsChecked - sm.indicatorsMissing.length}/${sm.indicatorsChecked}${sm.indicatorsMissing.length ? ` (missing: ${sm.indicatorsMissing.join(", ")})` : ""}`);
    const errors = new Set(report.issues.filter((i) => i.severity === "error").map((i) => i.row));
    report.errorRows = errors.size; report.canLoad = errors.size === 0 && !report.batchFlags.some((f) => f.severity === "error");
  }
  const rebalance = option("--rebalance");
  if (rebalance) {
    const balanced = balanceAnswerKey(parsed.rows);
    const line = (r: Record<string, string>) => LOAD_COLUMNS.map((c) => `"${(r[c] ?? "").replace(/"/g, '""')}"`).join(",");
    await writeFile(rebalance, "\ufeff" + LOAD_COLUMNS.join(",") + "\r\n" + balanced.rows.map(line).join("\r\n") + "\r\n", "utf8");
    console.log(`Answer letters rebalanced: ${JSON.stringify(balanced.report.before)} -> ${JSON.stringify(balanced.report.after)} (${balanced.report.moved} rows changed${balanced.report.skipped.length ? `, rows left alone because they mention option positions: ${balanced.report.skipped.join(", ")}` : ""}). Written to ${rebalance}`);
  }
  const top = (counts: Record<string, number>, n = 8) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}: ${v}`).join(" | ");

  console.log(`File: ${files.map((f) => basename(f)).join(", ")}${parsed.sheet ? ` (sheet ${parsed.sheet})` : ""}   Scope: ${scope}`);
  if (parsed.unknownColumns.length) console.log(`Ignored columns: ${parsed.unknownColumns.join(", ")}`);
  console.log(`Rows: ${report.rows}   clean: ${report.cleanRows}   with warnings only: ${report.warningRows}   with errors: ${report.errorRows}`);
  console.log(`Level: ${top(report.counts.level)}\nGrade: ${top(report.counts.grade)}\nSubject: ${top(report.counts.subject)}\nDifficulty: ${top(report.counts.difficulty)}\nCognitive: ${top(report.counts.cognitive)}\nAnswer type: ${top(report.counts.answerType)}\nCorrect letters: ${top(report.counts.correct)}\nIndicators/topics: ${Object.keys(report.counts.indicator).length}`);
  const complete = report.topics.filter((t) => t.rows === topicBlock).length;
  console.log(`
Topics: ${report.topics.length}   complete blocks of ${topicBlock}: ${complete}`);
  for (const t of report.topics.slice(0, 40)) console.log(`  ${String(t.rows).padStart(3)} questions  easy/medium/hard ${t.easy}/${t.medium}/${t.hard}  concepts ${t.concepts}  ${t.indicator ? t.indicator + "  " : ""}${t.topic}`);
  if (report.topics.length > 40) console.log(`  ... and ${report.topics.length - 40} more topics`);
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
