import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import { buildIndex, standardCode, type CurriculumIndex, type VerifiedIndicator } from "@/lib/curriculum/verified";
import type { LoadPayload } from "@/lib/question-loading/payload";
import { continueFrom, describeLoadFailure, isTransientFailure, sliceCall } from "@/lib/question-loading/resume";

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

// An earlier load of exactly this file, if any: the database's own record of how far it got (rows_total counts the rows it has taken).
export type LoadBatchState = { id: string; status: string; rows_total: number; rows_loaded: number; rows_rejected: number; file_name: string };
const BATCH_COLUMNS = "id,status,rows_total,rows_loaded,rows_rejected,file_name";
export async function findLoadBatchByHash(fileSha256: string): Promise<LoadBatchState | null> {
  const { data, error } = await getSupabaseBrowserClient().from("question_load_batches").select(BATCH_COLUMNS).eq("file_sha256", fileSha256).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return error ? null : ((data ?? null) as LoadBatchState | null);
}
async function readLoadBatch(id: string): Promise<LoadBatchState | null> {
  const { data, error } = await getSupabaseBrowserClient().from("question_load_batches").select(BATCH_COLUMNS).eq("id", id).maybeSingle();
  return error ? null : ((data ?? null) as LoadBatchState | null);
}

// Sends the payload in small requests; the first one records the file, the rest continue the same batch. Three safeguards:
//  1. After ANY failure the database is asked how far it really got, because a time-out can arrive after the work was done. Rows it already took are never sent again.
//  2. Time-outs and dropped connections are retried (twice); a rule the database refused is not, and stops the load with a message that says where and why.
//  3. A load that stopped partway is continued with `resume` (batch id and the database's own row count), so an interrupted file is finished, never repeated.
export async function runQuestionLoad(input: {
  payload: LoadPayload; fileName: string; fileSha256: string; marketId: string; curriculumId: string; sourceIds: string[];
  resume?: { batchId: string; fromRow: number }; retryDelayMs?: number; onProgress?: (done: number, total: number) => void;
}): Promise<LoadResult> {
  const supabase = getSupabaseBrowserClient(), total = input.payload.rows.length, wait = input.retryDelayMs ?? 1500;
  let batchId: string | undefined = input.resume?.batchId, offset = continueFrom(input.resume?.fromRow, total), last: any = null;
  let errors: Array<{ row: number; code: string }> = [];
  // A fresh load of a file the database already knows is refused up front, in plain words, instead of failing request by request.
  if (!input.resume) {
    const earlier = await findLoadBatchByHash(input.fileSha256);
    if (earlier) throw new Error(earlier.status === "LOADING"
      ? `This file was loaded before and stopped after ${earlier.rows_total} of ${total} questions. Choose Continue to finish it.`
      : `This exact file was already loaded (status ${earlier.status}, ${earlier.rows_total} questions). Nothing was sent.`);
  }
  input.onProgress?.(offset, total);
  while (offset < total) {
    const call = sliceCall(input.payload, offset), end = offset + call.rows.length;
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await supabase.rpc("qb_question_load", { p: {
        batch_id: batchId, file_name: input.fileName, file_sha256: input.fileSha256, expected_rows: input.payload.expectedRows, scope: "CURRICULUM",
        market_id: input.marketId, curriculum_id: input.curriculumId, source_document_ids: input.sourceIds, topics: call.topics, rows: call.rows } });
      if (!error) {
        last = data; batchId = data.batch_id;
        errors = errors.concat((data.import?.row_errors ?? []).map((e: { row: number; code: string }) => ({ ...e, row: e.row + offset })));
        offset = end; break;
      }
      // Failed: find out what the database actually holds before deciding anything.
      const held = await findLoadBatchByHash(input.fileSha256);
      if (held) {
        batchId = held.id;
        // Only a time-out or dropped connection can mean "the work was done but the answer was lost"; a refusal never does.
        if (isTransientFailure(error) && held.rows_total >= end) { offset = end; break; }
        if (held.rows_total < offset) throw new Error(describeLoadFailure("The database holds fewer questions than this load expected, so it was stopped to avoid a gap.", error, { fromRow: offset, toRow: end, total }));
      }
      if (attempt < 2 && isTransientFailure(error)) { if (wait > 0) await new Promise((r) => setTimeout(r, wait * (attempt + 1))); continue; }
      throw new Error(describeLoadFailure(userFacingError(error), error, { fromRow: offset, toRow: end, total }));
    }
    input.onProgress?.(offset, total);
  }
  const final = batchId ? await readLoadBatch(batchId) : null;
  const status = final?.status ?? last?.status ?? "LOADING";
  return { batch_id: batchId ?? last?.batch_id, status, rows_total: final?.rows_total ?? last?.rows_total ?? offset, rows_loaded: final?.rows_loaded ?? last?.rows_loaded ?? 0,
    rows_rejected: final?.rows_rejected ?? last?.rows_rejected ?? 0, row_errors: errors };
}
