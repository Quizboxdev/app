import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { AuditedQuestion, NormalizedCurriculumNode } from "../lib/content/types";
import { canonicalKey, databaseIdentity, expectedParentKey, validateGraph } from "./validate-curriculum";

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] != null) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function main() {
  await loadLocalEnvironment();
  const apply = process.argv.includes("--apply");
  const reportDirectory = path.join(process.cwd(), "reports");
  const nodes = JSON.parse(await readFile(path.join(reportDirectory, "curriculum-nodes.json"), "utf8")) as NormalizedCurriculumNode[];
  const audit = JSON.parse(await readFile(path.join(reportDirectory, "question-audit.json"), "utf8")) as { questions: AuditedQuestion[] };
  const prepared = audit.questions.filter((row) => row.classification !== "rejected");
  const graph = validateGraph(nodes);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", curriculumNodes: nodes.length, questionsPrepared: prepared.length, rejected: audit.questions.length - prepared.length }, null, 2));
  if (graph.unresolved.length || graph.collisions.length || graph.invalidParentTypes.length || graph.cycles.length) throw new Error("Curriculum graph validation failed; inspect reports/unresolved-curriculum-parents.json");
  if (!apply) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Local Supabase admin environment is required for --apply");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminEmail = process.env.QUIZBOX_ADMIN_EMAIL ?? "admin.test@quizbox.local";
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const importingUser = authData?.users.find((user) => user.email?.toLowerCase() === adminEmail.toLowerCase());
  if (authError || !importingUser) throw new Error("Configured content-admin Auth user was not found");

  const curriculaByKey = new Map<string, string>();
  for (const node of nodes) {
    const key = `${node.curriculumCode}:${node.curriculumVersion}`;
    if (curriculaByKey.has(key)) continue;
    const { data, error } = await supabase.from("curricula").upsert({ code: node.curriculumCode, name: node.curriculumName, country: node.country, version: node.curriculumVersion, status: "ACTIVE" }, { onConflict: "code,version" }).select("id").single();
    if (error) throw error;
    curriculaByKey.set(key, data.id);
  }

  const normalizedByKey = new Map(nodes.map((node) => [canonicalKey(node), node]));
  const parentNodeFor = (node: NormalizedCurriculumNode) => {
    const key = expectedParentKey(node);
    return key ? normalizedByKey.get(key) : undefined;
  };
  const nodeIds = new Map<string, string>();
  const existingRows: Array<{ id: string; curriculum_id: string; identity_key: string; education_level: string | null; grade_code: string | null; subject_code: string | null; node_type: NormalizedCurriculumNode["nodeType"]; code: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("curriculum_nodes").select("id,curriculum_id,identity_key,education_level,grade_code,subject_code,node_type,code").range(from, from + 999);
    if (error) throw error;
    existingRows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const repairs = existingRows.map((row) => ({
    row,
    identity: [row.education_level ?? "GLOBAL", row.grade_code ?? "GLOBAL", row.subject_code ?? "GLOBAL", row.node_type, row.code].join("|"),
  })).filter(({ row, identity }) => row.identity_key !== identity);
  for (let start = 0; start < repairs.length; start += 20) {
    const chunk = repairs.slice(start, start + 20);
    const results = await Promise.all(chunk.map(({ row, identity }) => supabase.from("curriculum_nodes").update({ identity_key: identity }).eq("id", row.id)));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  }
  for (const { row, identity } of existingRows.map((row) => ({ row, identity: [row.education_level ?? "GLOBAL", row.grade_code ?? "GLOBAL", row.subject_code ?? "GLOBAL", row.node_type, row.code].join("|") }))) {
    nodeIds.set(`${row.curriculum_id}:${identity}`, row.id);
  }
  const pending = [...nodes];
  for (let pass = 0; pass < 10 && pending.length; pass += 1) {
    const eligible = pending.filter((node) => {
      const curriculumId = curriculaByKey.get(`${node.curriculumCode}:${node.curriculumVersion}`)!;
      const parentNode = parentNodeFor(node);
      return !node.parentCode || (parentNode != null && nodeIds.has(`${curriculumId}:${databaseIdentity(parentNode)}`));
    });
    if (!eligible.length) break;
    for (let start = 0; start < eligible.length; start += 250) {
      const chunk = eligible.slice(start, start + 250);
      const payload = chunk.map((node) => {
        const curriculumId = curriculaByKey.get(`${node.curriculumCode}:${node.curriculumVersion}`)!;
        const parentNode = parentNodeFor(node);
        return { curriculum_id: curriculumId, parent_id: parentNode ? nodeIds.get(`${curriculumId}:${databaseIdentity(parentNode)}`) : null, node_type: node.nodeType, code: node.code, identity_key: databaseIdentity(node), title: node.title, source_terminology: node.sourceTerminology, education_level: node.educationLevel, grade_code: node.canonicalGradeCode ?? node.grade, source_grade_code: node.sourceGradeCode ?? node.grade, canonical_grade_code: node.canonicalGradeCode ?? node.grade, subject_code: node.subject, source_file: node.sourceFile, source_version: node.sourceVersion, is_active: node.active };
      });
      const { data, error } = await supabase.from("curriculum_nodes").upsert(payload, { onConflict: "curriculum_id,identity_key" }).select("id,curriculum_id,identity_key");
      if (error) throw error;
      for (const row of data ?? []) nodeIds.set(`${row.curriculum_id}:${row.identity_key}`, row.id);
    }
    const imported = new Set(eligible);
    for (let index = pending.length - 1; index >= 0; index -= 1) if (imported.has(pending[index])) pending.splice(index, 1);
  }
  if (pending.length) throw new Error(`${pending.length} curriculum nodes have unresolved parents`);

  const grouped = new Map<string, AuditedQuestion[]>();
  for (const row of prepared) grouped.set(row.question.sourceHash, [...(grouped.get(row.question.sourceHash) ?? []), row]);
  for (const [sourceHash, rows] of grouped) {
    const { data: batch, error: batchError } = await supabase.from("content_import_batches").upsert({ source_file: rows[0].question.sourceFile, source_hash: sourceHash, imported_by: importingUser.id, status: "VALIDATED", records_detected: rows.length, valid_records: rows.filter((row) => row.classification === "valid").length, warning_records: rows.filter((row) => row.classification === "warning").length }, { onConflict: "source_hash" }).select("id").single();
    if (batchError) throw batchError;
    const payload = rows.map((row, index) => ({ import_batch_id: batch.id, row_number: index + 1, external_source_id: row.question.externalSourceId, normalized_payload: row.question, fingerprint: row.fingerprint, classification: row.classification, issues: row.issues }));
    const { error } = await supabase.from("question_import_staging").upsert(payload, { onConflict: "import_batch_id,row_number" });
    if (error) throw error;
  }
  console.log(JSON.stringify({ status: "prepared", curriculumNodesImported: nodeIds.size, questionRowsStaged: prepared.length }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Import failed"); process.exitCode = 1; });

