import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import { buildIndex, standardCode, type CurriculumIndex, type VerifiedIndicator } from "@/lib/curriculum/verified";
import { chunkPayload, type LoadPayload } from "@/lib/question-loading/payload";

type NodeRow = { id: string; parent_id: string | null; node_type: string; code: string; title: string; subject_code: string | null; canonical_grade_code: string | null; grade_code: string | null; education_level: string | null; metadata: Record<string, unknown> | null };

// The curriculum as loaded in the database: every active learning indicator with its strand, sub-strand and content standard.
export async function loadCurriculumIndex(curriculumId: string): Promise<CurriculumIndex> {
  const supabase = getSupabaseBrowserClient(), nodes = new Map<string, NodeRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("curriculum_nodes")
      .select("id,parent_id,node_type,code,title,subject_code,canonical_grade_code,grade_code,education_level,metadata")
      .eq("curriculum_id", curriculumId).eq("is_active", true).order("sort_order").range(from, from + 999);
    if (error) throw new Error(userFacingError(error));
    for (const n of (data ?? []) as NodeRow[]) nodes.set(n.id, n);
    if (!data || data.length < 1000) break;
  }
  const up = (n: NodeRow, type: string) => { let cur: NodeRow | undefined = n; for (let i = 0; cur && i < 8; i++) { if (cur.node_type === type) return cur; cur = cur.parent_id ? nodes.get(cur.parent_id) : undefined; } return undefined; };
  const rows: VerifiedIndicator[] = [];
  for (const n of nodes.values()) {
    if (n.node_type !== "learning_indicator") continue;
    const cs = up(n, "content_standard"), sub = up(n, "sub_strand"), strand = up(n, "strand");
    const grade = n.canonical_grade_code ?? n.grade_code ?? "";
    rows.push({ subject: n.subject_code ?? "", grade, strand_no: strand?.code.replace(/^STRAND:/, "") ?? "", strand: strand?.title ?? "", sub_strand: sub?.title ?? "",
      content_standard_code: cs?.code.split("@")[0] ?? "", content_standard: cs?.title ?? "",
      indicator_code: standardCode(String(n.metadata?.standard_code ?? n.code.split("@")[0].split("~")[0])), indicator: n.title, printed_code: String(n.metadata?.printed_code ?? ""),
      exemplars: String(n.metadata?.exemplars ?? ""), page: String(n.metadata?.page ?? ""), wording_verified: String(n.metadata?.wording_verified ?? ""), flags: "",
      level: n.education_level === "SHS" ? "SHS" : n.education_level === "JHS" ? "JHS" : n.education_level === "Primary" ? "Primary" : "OTHER", node_id: n.id });
  }
  return buildIndex(rows);
}

export type ApprovedSource = { id: string; title: string };
export async function listApprovedSources(curriculumId: string): Promise<ApprovedSource[]> {
  const { data, error } = await getSupabaseBrowserClient().from("source_documents").select("id,title")
    .eq("curriculum_id", curriculumId).eq("validation_status", "approved").eq("rights_confirmed", true).order("title");
  if (error) throw new Error(userFacingError(error));
  return (data ?? []) as ApprovedSource[];
}

export type LoadResult = { batch_id: string; status: string; rows_total: number; rows_loaded: number; rows_rejected: number; row_errors: Array<{ row: number; code: string }> };

// Sends the payload in calls of at most 500 rows; the first call records the file, the rest continue the same batch.
export async function runQuestionLoad(input: {
  payload: LoadPayload; fileName: string; fileSha256: string; marketId: string; curriculumId: string; sourceIds: string[]; onProgress?: (done: number, total: number) => void;
}): Promise<LoadResult> {
  const supabase = getSupabaseBrowserClient(), calls = chunkPayload(input.payload, 500);
  let batchId: string | undefined, last: any, errors: Array<{ row: number; code: string }> = [], offset = 0;
  for (const call of calls) {
    const { data, error } = await supabase.rpc("qb_question_load", { p: {
      batch_id: batchId, file_name: input.fileName, file_sha256: input.fileSha256, expected_rows: input.payload.expectedRows, scope: "CURRICULUM",
      market_id: input.marketId, curriculum_id: input.curriculumId, source_document_ids: input.sourceIds, topics: call.topics, rows: call.rows } });
    if (error) throw new Error(userFacingError(error));
    last = data; batchId = data.batch_id;
    errors = errors.concat((data.import?.row_errors ?? []).map((e: { row: number; code: string }) => ({ ...e, row: e.row + offset })));
    offset += call.rows.length; input.onProgress?.(offset, input.payload.expectedRows);
  }
  return { batch_id: last.batch_id, status: last.status, rows_total: last.rows_total, rows_loaded: last.rows_loaded, rows_rejected: last.rows_rejected, row_errors: errors };
}
