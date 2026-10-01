import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

async function loadLocalEnvironment() {
  const contents = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const increment = (record: Record<string, number>, key?: string | null) => { record[key || "Unclassified"] = (record[key || "Unclassified"] ?? 0) + 1; };

async function main() {
  await loadLocalEnvironment();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Local Supabase admin environment is required");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("curriculum_nodes").select("id,curriculum_id,parent_id,node_type,identity_key,education_level,grade_code,subject_code").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const { data: curricula, error: curriculaError } = await supabase.from("curricula").select("id,code,name,version");
  if (curriculaError) throw curriculaError;
  const curriculumNames = new Map((curricula ?? []).map((row) => [row.id, `${row.name} ${row.version}`]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const identities = new Set<string>();
  let duplicates = 0;
  let orphans = 0;
  let invalidParentTypes = 0;
  const allowedParent: Record<string, string[]> = {
    grade: ["education_level"], subject: ["grade"], strand: ["subject"], topic: ["subject"],
    sub_strand: ["strand", "subject"], subtopic: ["topic", "subject"],
    content_standard: ["sub_strand", "subtopic", "subject"], learning_indicator: ["content_standard"], learning_objective: ["content_standard"],
  };
  const byCurriculum: Record<string, number> = {}, byEducationLevel: Record<string, number> = {}, byGrade: Record<string, number> = {}, bySubject: Record<string, number> = {}, byNodeType: Record<string, number> = {};
  for (const row of rows) {
    const identity = `${row.curriculum_id}:${row.identity_key}`;
    if (identities.has(identity)) duplicates += 1;
    identities.add(identity);
    increment(byCurriculum, curriculumNames.get(row.curriculum_id) ?? row.curriculum_id);
    increment(byEducationLevel, row.education_level); increment(byGrade, row.grade_code); increment(bySubject, row.subject_code); increment(byNodeType, row.node_type);
    if (row.node_type !== "education_level" && !row.parent_id) orphans += 1;
    if (row.parent_id) {
      const parent = byId.get(row.parent_id);
      if (!parent || !(allowedParent[row.node_type] ?? []).includes(parent.node_type)) invalidParentTypes += 1;
    }
  }
  const report = { generatedAt: new Date().toISOString(), totalNodes: rows.length, byCurriculum, byEducationLevel, byGrade, bySubject, byNodeType, orphanCount: orphans, duplicateIdentityCount: duplicates, invalidParentTypeCount: invalidParentTypes };
  await writeFile(path.join(process.cwd(), "reports", "curriculum-import-verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (orphans || duplicates || invalidParentTypes) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
