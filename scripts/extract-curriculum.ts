import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { extractCurriculum, type CurriculumPage } from "../lib/curriculum/extract";

// Usage: npx tsx scripts/extract-curriculum.ts <curriculum.pdf> --subject "Science" [--grade B7] [--out extract.csv]
// Reads an official curriculum PDF and writes one row per learning indicator, exactly as printed. No AI involved.
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith("--") && !["--subject", "--grade", "--out"].includes(args[i - 1]));
const subject = option("--subject"), gradeFilter = option("--grade"), out = option("--out");
if (!file || !subject) { console.error("Usage: tsx scripts/extract-curriculum.ts <curriculum.pdf> --subject <name> [--grade B7] [--out file.csv]"); process.exit(2); }
const path: string = file;
const subjectName: string = subject;

async function main() {
  const { PDFParse } = await import("pdf-parse") as any;
  const parser = new PDFParse({ data: new Uint8Array(await readFile(path)) });
  const result = await parser.getText(); await parser.destroy();
  const pages: CurriculumPage[] = result.pages.map((p: any) => ({ n: p.num, text: p.text }));
  const extraction = extractCurriculum(pages);
  const rows = extraction.rows.filter((r) => !gradeFilter || r.grade === gradeFilter);
  const byGrade: Record<string, number> = {};
  for (const r of rows) byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1;
  console.log(`${basename(path)}: ${pages.length} pages; indicators extracted ${rows.length} (${Object.entries(byGrade).map(([g, n]) => `${g}: ${n}`).join(", ")}); codes seen in text ${extraction.codesInText.length}`);
  const strands = new Map<string, number>();
  for (const r of rows) { const k = `${r.grade} strand ${r.strandNo} ${r.strand}`; strands.set(k, (strands.get(k) ?? 0) + 1); }
  for (const [k, n] of strands) console.log(`  ${k}: ${n} indicators`);
  const anomalies = extraction.anomalies.filter((a) => !gradeFilter || a.includes(` ${gradeFilter}.`));
  console.log(anomalies.length ? `Anomalies (${anomalies.length}):\n  ${anomalies.slice(0, 40).join("\n  ")}` : "Anomalies: none");
  if (out) {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["source_file", "grade", "subject", "strand_no", "strand", "sub_strand_no", "sub_strand", "content_standard_code", "content_standard", "indicator_code", "indicator", "exemplars", "page_physical", "page_printed"];
    await writeFile(out, "\ufeff" + header.join(",") + "\r\n" + rows.map((r) => [basename(path), r.grade, subjectName, r.strandNo, r.strand, r.subStrandNo, r.subStrand, r.contentStandardCode, r.contentStandard, r.indicatorCode, r.indicator, r.exemplars.map((e, i) => `${i + 1}) ${e}`).join(" || "), r.pagePhysical, r.pagePrinted].map((v) => q(v)).join(",")).join("\r\n") + "\r\n", "utf8");
    console.log(`Written ${out}`);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 2; });
