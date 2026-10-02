import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { operatorClient, allRows } from "./operator";
import { WAVE_ONE_OBJECTIVES, WAVE_ONE_SOURCE_VERSION, waveOneBatch } from "../lib/content/factory/wave-one";
import { validateCandidate, validateSpec, normalize } from "../lib/content/factory/contract";
import { duplicateWarnings, similarity } from "../lib/content/factory/duplicates";

async function main() {
  if (process.argv.includes("--apply") && process.argv.includes("--dry-run")) throw new Error("CHOOSE_APPLY_OR_DRY_RUN");
  const apply = process.argv.includes("--apply");
  process.loadEnvFile(".env.local");
  // A read-only server operator can prepare drafts; all mutations still require an authenticated reviewer.
  if (!apply && !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("WAVE_READ_ONLY_OPERATOR_REQUIRED");
  const client = apply ? await operatorClient() : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const nodes = await allRows(client, "curriculum_nodes"), map = new Map(nodes.map(n => [n.id, n]));
  const taxonomy = JSON.parse(await readFile("reports/curriculum-nodes.json", "utf8"));
  const current = await allRows(client, "questions", "external_question_id,question_text");
  const batches = [];
  for (const objective of WAVE_ONE_OBJECTIVES) {
    const matches = nodes.filter(n => n.subject_code === objective.subject && n.code === objective.code && n.is_active && n.canonical_grade_code === "SHS1");
    if (matches.length !== 1) throw new Error("WAVE_NODE_NOT_UNIQUE");
    const source = taxonomy.find((n: any) => n.subject === objective.subject && n.code === objective.code);
    if (!source?.sourceFile || /[/\\]/.test(source.sourceFile)) throw new Error("WAVE_PROVENANCE_MISSING");
    const bytes = await readFile("../Curriculum/" + source.sourceFile);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (!sha256.startsWith(source.sourceVersion)) throw new Error("CURRICULUM_SOURCE_CHANGED");
    batches.push(waveOneBatch(matches[0], { file: source.sourceFile, sha256 }));
  }
  const candidates = batches.flatMap(b => b.candidates);
  const validation = candidates.map(q => ({ id: q.external_question_id, issues: validateCandidate(q, map),
    duplicates: [...duplicateWarnings(q, candidates), ...current.filter(r => r.external_question_id !== q.external_question_id && similarity(q.question_text, r.question_text) >= 0.85)
      .map(r => ({ externalId: r.external_question_id, group: `live:${r.external_question_id}`, kind: normalize(q.question_text) === normalize(r.question_text) ? "exact" : "near", similarity: similarity(q.question_text, r.question_text) }))] }));
  if (validation.some(r => r.issues.some(i => i.severity === "error")) || batches.some(b => validateSpec(b.spec, map.get(b.spec.indicatorId)).length)) throw new Error("WAVE_STRUCTURAL_VALIDATION_FAILED");
  if (validation.some(r => r.duplicates.some(d => d.kind === "exact"))) throw new Error("WAVE_EXACT_DUPLICATE_REQUIRES_REVIEW");
  await mkdir(".local-backups", { recursive: true });
  await writeFile(".local-backups/wave-one-candidates-v1.json", JSON.stringify({ batches, validation, humanApprovalRequired: true }, null, 2), { mode: 0o600 });
  const receipts = [];
  for (const batch of batches) {
    if (apply) {
      const result = await client.rpc("qb_content_ingest", { p_spec: batch.spec, p_candidates: batch.candidates,
        p_source_file: `wave-one-${batch.spec.subject}-${batch.spec.indicatorCode}.json`, p_provider: "Codex-assisted-original-composition", p_model: "editorial-original-v1" });
      if (result.error) throw new Error(result.error.message.startsWith("QB_") ? result.error.message.split(":")[0] : "WAVE_IMPORT_FAILED");
      receipts.push({ indicatorId: batch.spec.indicatorId, ...result.data });
    }
  }
  const delivered = await client.from("questions").select("id,external_question_id,validation_status,status,curriculum_node_id,source_type").eq("source_version", WAVE_ONE_SOURCE_VERSION);
  if (delivered.error) throw new Error("WAVE_VERIFICATION_FAILED");
  if (apply && (delivered.data.length !== 45 || delivered.data.some(q => q.validation_status !== "review" || q.status !== "inactive" || q.source_type !== "AI_GENERATED"))) throw new Error("WAVE_REVIEW_STATE_MISMATCH");
  const queue = apply ? await client.rpc("qb_content_queue", { p_filters: { source: "production", status: "review" }, p_page: 1, p_limit: 25 }) : null;
  if (queue?.error) throw new Error("WAVE_QUEUE_VERIFICATION_FAILED");
  const production = await client.from("questions").select("source_type,validation_status,status,curriculum_node_id");
  if (production.error) throw new Error("WAVE_QUEUE_VERIFICATION_FAILED");
  const productionRows = production.data.filter(q => !["DEV_ACCEPTANCE_FIXTURE", "DEV_FACTORY_PILOT"].includes(q.source_type));
  const productionQueue = queue?.data.total ?? productionRows.filter(q => q.validation_status === "review").length;
  const report = { checkedAt: new Date().toISOString(), mode: apply ? "applied" : delivered.data.length === 45 ? "verified-existing" : "dry-run", sourceVersion: WAVE_ONE_SOURCE_VERSION,
    productionCandidatesPrepared: candidates.length, productionCandidatesInReview: delivered.data.length, productionReviewQueue: productionQueue,
    approvedProduction: productionRows.filter(q => q.status === "active" && q.validation_status === "approved" && q.curriculum_node_id).length,
    autoApproved: 0, humanReviewRequired: true, exactDuplicates: 0, nearDuplicateWarnings: validation.flatMap(r => r.duplicates),
    indicators: batches.map(b => ({ id: b.spec.indicatorId, code: b.spec.indicatorCode, importedTitle: b.spec.indicatorTitle,
      sourceObjectiveSummary: b.objective.objective, grade: b.spec.grade, sourceGrade: "B10", subject: b.spec.subject,
      curriculumSource: b.curriculumSource, candidates: b.candidates.length, validationStatus: "review" })), receipts };
  await writeFile("reports/wave-one-review-import.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: report.mode, indicators: batches.length, candidatesPrepared: candidates.length,
    candidatesInReview: delivered.data.length, productionReviewQueue: productionQueue, exactDuplicates: 0, nearDuplicateWarnings: report.nearDuplicateWarnings.length, autoApproved: 0 }));
}
main().catch(e => { console.error(e instanceof Error && /^WAVE_|^CURRICULUM_|^QB_|^OPERATOR_|^CONTENT_OPERATOR_/.test(e.message) ? e.message : "WAVE_IMPORT_FAILED"); process.exitCode = 1; });
