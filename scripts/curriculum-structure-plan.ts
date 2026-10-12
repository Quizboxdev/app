import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildStructure, chunkNodes, type StructureNode } from "../lib/curriculum/structure";
import { parseVerifiedCsv } from "../lib/curriculum/verified";

// Usage: npx tsx scripts/curriculum-structure-plan.ts <verified.csv> [--out plan.json] [--expect-indicators 1012] [--level Primary|JHS|SHS]
// Read-only. Builds the exact node list the Curriculum structure screen would send to qb_curriculum_nodes_import, checks it, and prints the counts.
// Checks: one level, every parent present and earlier in the list, unique identity keys, no node dropped, collisions reported, grades inside the level.
const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && !["--out", "--expect-indicators", "--level"].includes(args[i - 1]));
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error("Usage: tsx scripts/curriculum-structure-plan.ts <verified.csv> [--out plan.json] [--expect-indicators N] [--level Primary|JHS|SHS]"); process.exit(2); }

const GRADES: Record<string, string[]> = { Primary: ["B4", "B5", "B6"], JHS: ["B7", "B8", "B9"], SHS: ["SHS1", "SHS2", "SHS3"] };

async function main() {
  const text = await readFile(file!, "utf8");
  const rows = parseVerifiedCsv(text);
  const plan = buildStructure(rows, { sourceFile: file!.split(/[\\/]/).pop()! });
  const failures: string[] = [];
  const levels = [...new Set(plan.nodes.map((n) => n.education_level))];
  if (levels.length !== 1) failures.push(`LEVELS: expected one level, found ${levels.join(", ") || "none"}`);
  const level = option("--level") ?? levels[0];
  if (option("--level") && levels[0] !== option("--level")) failures.push(`LEVEL: file is ${levels[0]}, expected ${option("--level")}`);
  const keys = new Map<string, number>();
  plan.nodes.forEach((n, i) => { if (keys.has(n.identity_key)) failures.push(`DUPLICATE_IDENTITY: ${n.identity_key}`); keys.set(n.identity_key, i); });
  plan.nodes.forEach((n, i) => {
    if (n.parent_key === null) { if (n.node_type !== "education_level") failures.push(`ORPHAN: ${n.identity_key}`); return; }
    const p = keys.get(n.parent_key);
    if (p === undefined) failures.push(`PARENT_MISSING: ${n.identity_key} -> ${n.parent_key}`);
    else if (p > i) failures.push(`PARENT_AFTER_CHILD: ${n.identity_key}`);
  });
  const allowed = GRADES[level] ?? [];
  for (const n of plan.nodes) if (n.node_type === "grade" && !allowed.includes(n.canonical_grade_code ?? "")) failures.push(`GRADE_NOT_IN_LEVEL: ${n.canonical_grade_code} (${level})`);
  if (plan.problems.length) failures.push(...plan.problems.map((p) => `ROW_PROBLEM: ${p}`));
  const expected = option("--expect-indicators");
  if (expected && plan.counts.learning_indicator !== Number(expected)) failures.push(`INDICATOR_COUNT: ${plan.counts.learning_indicator} nodes for ${expected} expected`);
  if (plan.counts.learning_indicator !== rows.length) failures.push(`ROWS_DROPPED: ${rows.length} rows, ${plan.counts.learning_indicator} indicator nodes`);
  const titles = new Map(plan.nodes.filter((n) => n.node_type === "learning_indicator").map((n) => [n.identity_key, n.title]));
  const lost = rows.filter((r) => ![...titles.values()].includes(r.indicator.trim()));
  if (lost.length) failures.push(`INDICATOR_TEXT_LOST: ${lost.length} rows (first: ${lost[0].indicator_code})`);

  const byGrade = new Map<string, number>(), bySubject = new Map<string, number>();
  for (const n of plan.nodes) if (n.node_type === "learning_indicator") {
    byGrade.set(n.canonical_grade_code!, (byGrade.get(n.canonical_grade_code!) ?? 0) + 1);
    const k = `${n.canonical_grade_code}|${n.subject_code}`; bySubject.set(k, (bySubject.get(k) ?? 0) + 1);
  }
  const chunks = chunkNodes(plan.nodes as StructureNode[], 400);
  console.log(`file: ${file}  sha256 ${createHash("sha256").update(text).digest("hex")}`);
  console.log(`level: ${level} | rows ${rows.length} | nodes ${plan.nodes.length} in ${chunks.length} import parts of at most 400`);
  console.log("counts:", JSON.stringify(plan.counts));
  console.log("indicators by grade:", JSON.stringify(Object.fromEntries(byGrade)));
  console.log(`collisions (kept as separate nodes, identity suffixed): ${plan.collisions.length}`);
  for (const c of plan.collisions) console.log("   ", c);
  const out = option("--out");
  if (out) {
    await writeFile(out, JSON.stringify({ level, source_file: plan.nodes[0]?.metadata ? file!.split(/[\\/]/).pop() : "", counts: plan.counts, collisions: plan.collisions, nodes: plan.nodes }, null, 1), "utf8");
    console.log("wrote", out);
  }
  if (failures.length) { console.error(`\nFAILED (${failures.length}):`); failures.slice(0, 40).forEach((f) => console.error("  " + f)); process.exit(1); }
  console.log("\nOK: hierarchy, identity keys, parent order and indicator count verified.");
}
main().catch((e) => { console.error(e); process.exit(1); });
