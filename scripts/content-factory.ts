import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { calculateCoverage } from "../lib/content/factory/coverage";
import { validateCandidate, type Candidate, type CurriculumNode } from "../lib/content/factory/contract";
import { duplicateWarnings } from "../lib/content/factory/duplicates";
import { generateQuestions, SampleProvider } from "../lib/content/factory/generation";

loadEnvConfig(process.cwd());
const [command, file] = process.argv.slice(2);
const apply = process.argv.includes("--apply");
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message.split(":")[0].startsWith("QB_") ? error.message.split(":")[0] : "CONTENT_RPC_FAILED");
  return data;
}
async function paginated(table: string, columns: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await client.from(table).select(columns).order("id").range(from, from + 499);
    if (error) throw new Error("CONTENT_READ_FAILED_" + table + "_" + error.code);
    rows.push(...(data ?? [])); if ((data?.length ?? 0) < 500) return rows;
  }
}
async function main() {
  if (apply && process.argv.includes("--dry-run")) throw new Error("CHOOSE_APPLY_OR_DRY_RUN");
  if (!["coverage", "validate", "duplicates", "generate", "import", "publish", "rejected"].includes(command)) throw new Error("Use coverage | validate file | duplicates file | generate file | import file [--apply] | publish file [--apply] | rejected batch-id");
  // Operator credentials stay local. No service-role key is used for editorial mutations.
  if (process.env.QB_CONTENT_OPERATOR_EMAIL && process.env.QB_CONTENT_OPERATOR_PASSWORD) {
    const { error } = await client.auth.signInWithPassword({ email: process.env.QB_CONTENT_OPERATOR_EMAIL, password: process.env.QB_CONTENT_OPERATOR_PASSWORD });
    if (error) throw new Error("CONTENT_OPERATOR_LOGIN_FAILED");
  }
  const nodes = await paginated("curriculum_nodes", "id,curriculum_id,parent_id,node_type,code,title,grade_code,source_grade_code,canonical_grade_code,subject_code,education_level,is_active") as CurriculumNode[];
  const map = new Map(nodes.map((n) => [n.id, n]));
  if (command === "coverage") {
    await rpc("qb_content_coverage", {});
    const questions = await paginated("questions", "curriculum_node_id,status,validation_status,source_type,difficulty_label,answer_type,duplicate_group_id");
    const overrides = await paginated("content_coverage_targets", "*");
    const report = { generatedAt: new Date().toISOString(), ...calculateCoverage(nodes, questions, 10, overrides) };
    await writeFile("reports/question-coverage.json", JSON.stringify(report, null, 2));
    await writeFile("reports/question-coverage.md", "# Question Coverage\n\n" + Object.entries(report.summary).map(([k,v]) => "- " + k + ": " + v).join("\n") + "\n\n## Grades and Subjects\n\n" + report.nodes.filter((n) => ["grade","subject"].includes(n.node_type)).map((n) => "- " + n.code + " " + n.title + ": " + n.approved + " approved / " + n.indicators + " indicators (" + n.health + ")").join("\n") + "\n\nAcceptance and factory pilot fixtures are excluded from production counts.\n");
    console.log(JSON.stringify(report.summary)); return;
  }
  if (command === "rejected") {
    const { data, error } = await client.from("question_import_staging").select("row_number,classification,issues").eq("import_batch_id", file).eq("classification", "rejected").limit(100);
    if (error) throw new Error("CONTENT_REPORT_DENIED"); console.log(JSON.stringify(data)); return;
  }
  const input = JSON.parse(await readFile(file, "utf8"));
  if (command === "publish") {
    if (!Array.isArray(input.ids) || input.ids.length > 100) throw new Error("INVALID_PUBLISH_LIST");
    const results = [];
    for (const id of input.ids) {
      const detail = await rpc("qb_content_detail", { p_id: id }), q = detail.question;
      if (q.validation_status !== "approved" || detail.validation_errors.length) throw new Error("QUESTION_NOT_APPROVED");
      if (apply) await rpc("qb_content_review", { p_id: id, p_action: "publish", p_version: q.version, p_expected_state: q.validation_status, p_patch: {}, p_note: input.note, p_human_reviewed: false });
      results.push({ id, status: apply ? "published" : "dry-run" });
    }
    console.log(JSON.stringify(results)); return;
  }
  let candidates: Candidate[] = input.candidates;
  if (!Array.isArray(candidates) || candidates.length > 100) throw new Error("INVALID_CANDIDATE_BATCH");
  if (command === "generate") {
    const node = map.get(input.spec.indicatorId); if (!node) throw new Error("INVALID_INDICATOR");
    candidates = await generateQuestions(input.spec, node, new SampleProvider(candidates));
  }
  const validation = candidates.map((q, i) => ({ row: i + 1, issues: validateCandidate(q, map), duplicates: duplicateWarnings(q, candidates) }));
  if (command === "duplicates") { console.log(JSON.stringify(validation.map(({row,duplicates}) => ({row,duplicates})))); return; }
  console.log(JSON.stringify({ dryRun: !apply, provider: command === "generate" ? "local-sample" : "provided-json", validation }));
  if (command === "import" && apply) console.log(JSON.stringify(await rpc("qb_content_ingest", { p_spec: input.spec, p_candidates: candidates, p_source_file: file, p_provider: "local-json", p_model: null })));
  if (command !== "import" && validation.some((row) => row.issues.some((issue) => issue.severity === "error"))) process.exitCode = 1;
}
main().catch((error) => { console.error(error instanceof SyntaxError ? "INVALID_JSON" : error instanceof Error && !/https?:|token|password|key=/i.test(error.message) ? error.message : "CONTENT_FACTORY_FAILED"); process.exitCode = 1; });
