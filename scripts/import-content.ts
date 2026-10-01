import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { AuditedQuestion, NormalizedCurriculumNode } from "../lib/content/types";

async function main() {
  const apply = process.argv.includes("--apply");
  const reportDirectory = path.join(process.cwd(), "reports");
  const nodes = JSON.parse(await readFile(path.join(reportDirectory, "curriculum-nodes.json"), "utf8")) as NormalizedCurriculumNode[];
  const audit = JSON.parse(await readFile(path.join(reportDirectory, "question-audit.json"), "utf8")) as { questions: AuditedQuestion[] };
  const prepared = audit.questions.filter((row) => row.classification !== "rejected");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", curriculumNodes: nodes.length, questionsPrepared: prepared.length, rejected: audit.questions.length - prepared.length }, null, 2));
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

  const nodeIds = new Map<string, string>();
  const pending = [...nodes];
  for (let pass = 0; pass < 8 && pending.length; pass += 1) {
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const node = pending[index];
      const curriculumId = curriculaByKey.get(`${node.curriculumCode}:${node.curriculumVersion}`)!;
      const parentKey = node.parentCode ? `${curriculumId}:${node.parentCode}` : undefined;
      if (parentKey && !nodeIds.has(parentKey)) continue;
      const { data, error } = await supabase.from("curriculum_nodes").upsert({ curriculum_id: curriculumId, parent_id: parentKey ? nodeIds.get(parentKey) : null, node_type: node.nodeType, code: node.code, title: node.title, source_terminology: node.sourceTerminology, education_level: node.educationLevel, grade_code: node.grade, subject_code: node.subject, source_file: node.sourceFile, source_version: node.sourceVersion, is_active: node.active }, { onConflict: "curriculum_id,node_type,code" }).select("id").single();
      if (error) throw error;
      nodeIds.set(`${curriculumId}:${node.code}`, data.id);
      pending.splice(index, 1);
    }
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

