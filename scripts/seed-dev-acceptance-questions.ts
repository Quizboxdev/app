import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

async function loadLocalEnvironment() {
  const text = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function main() {
  await loadLocalEnvironment();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Local Supabase admin environment is required");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: nodes, error: nodeError } = await supabase.from("curriculum_nodes").select("id,code,title,subject_code,grade_code,source_grade_code,canonical_grade_code").eq("node_type", "learning_indicator").not("subject_code", "is", null).neq("subject_code", "Unclassified").order("subject_code").order("code");
  if (nodeError) throw nodeError;
  const selected = new Map<string, any>();
  for (const node of nodes ?? []) if (!["Computing", "Mathematics", "Science"].includes(node.subject_code)) continue; else if (!selected.has(node.subject_code)) selected.set(node.subject_code, node);
  if (selected.size < 3) throw new Error("Expected Computing, Mathematics, and Science learning indicators");

  const rows: any[] = [];
  const subjects = ["Computing", "Mathematics", "Science"];
  for (const subject of subjects) {
    const node = selected.get(subject);
    for (let index = 0; index < 10; index += 1) {
      const trueFalse = index % 5 === 4;
      const difficulty = index < 4 ? "easy" : index < 8 ? "medium" : "hard";
      const externalId = `DEV_ACCEPTANCE_FIXTURE_${subject.toUpperCase()}_${String(index + 1).padStart(2, "0")}`;
      rows.push({
        external_question_id: externalId,
        question_code: externalId,
        subject_code: subject,
        subject_name: subject,
        grade: node.grade_code,
        source_grade_code: node.source_grade_code ?? node.grade_code,
        canonical_grade_code: node.canonical_grade_code ?? node.grade_code,
        curriculum_node_id: node.id,
        indicator_code: node.code,
        indicator_text: node.title,
        question_text: trueFalse ? `[DEV ACCEPTANCE FIXTURE] ${subject}: The statement about ${node.title} is true.` : `[DEV ACCEPTANCE FIXTURE] ${subject}: Which option best demonstrates ${node.title}?`,
        option_a: trueFalse ? "True" : "The first option is the best demonstration.",
        option_b: trueFalse ? "False" : "The second option is the best demonstration.",
        option_c: trueFalse ? "Not enough information" : "The third option is the best demonstration.",
        option_d: trueFalse ? "Both statements are false" : "The fourth option is the best demonstration.",
        correct_answer: trueFalse ? (index % 2 ? "B" : "A") : ["A", "B", "C", "D"][index % 4],
        answer_type: trueFalse ? "TRUE_FALSE" : "SINGLE_CHOICE",
        explanation: `Developer acceptance explanation for ${node.code}; this fixture is not editorial content.`,
        hint: `Review the objective ${node.code}.`,
        difficulty_code: difficulty,
        difficulty_label: difficulty,
        cognitive_level: difficulty === "hard" ? "apply" : difficulty === "medium" ? "understand" : "remember",
        marks: 1,
        status: "active",
        validation_status: "approved",
        source_type: "DEV_ACCEPTANCE_FIXTURE",
        source_storage_path: "dev/acceptance-fixtures",
        commercial_status: "INTERNAL_ONLY",
        tags: ["DEV_ACCEPTANCE_FIXTURE", "INTERNAL_ONLY"],
        rendering_version: 1,
        version: 1,
        question_content: { blocks: [{ type: "text", text: `[DEV ACCEPTANCE FIXTURE] ${subject} question for ${node.code}.` }] },
      });
    }
  }
  const ids = rows.map((row) => row.external_question_id);
  const { data: existing, error: existingError } = await supabase.from("questions").select("external_question_id").in("external_question_id", ids);
  if (existingError) throw existingError;
  const existingIds = new Set((existing ?? []).map((row) => row.external_question_id));
  const missing = rows.filter((row) => !existingIds.has(row.external_question_id));
  if (missing.length) {
    const { error } = await supabase.from("questions").insert(missing);
    if (error) throw error;
  }
  console.log(JSON.stringify({ namespace: "DEV_ACCEPTANCE_FIXTURE", requested: rows.length, inserted: missing.length, alreadyPresent: rows.length - missing.length, subjects, objectives: [...selected.values()].map((node) => node.code) }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : JSON.stringify({ message: error?.message, code: error?.code, details: error?.details, hint: error?.hint })); process.exitCode = 1; });
