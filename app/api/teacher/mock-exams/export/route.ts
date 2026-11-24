import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { toCsv, toXlsx, type ExportData } from "@/lib/exports/file";
import { mockExportFileName, parseMockExportRequest } from "@/lib/mock-exams/export-request";
import { MESSAGES } from "@/lib/mock-exams/messages";

// Mock-exam results export (CSV or Excel). The caller's OWN session decides what they may export: qb_mock_export checks that they own the exam, includes only attempts on assignments they own or manage
// (and marketplace buyers without any identity), caps the rows (setting mock_exams.export_row_limit, 50,000 by default; the response says when the cap cut the file short) and writes an audit entry.
// Text cells that start with = + - @ are neutralised by toCsv, and Excel text is written as text, so a learner's typed answer can never run as a formula. format "json" returns a short preview for the screen.
export const runtime = "nodejs";
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const STATUS: Record<string, number> = { QB_AUTHENTICATION_REQUIRED: 401, QB_NOT_FOUND: 404, QB_FEATURE_DISABLED: 403, QB_MOCK_AUTHOR_FORBIDDEN: 403, QB_MOCK_SPONSOR_NOT_VERIFIED: 403, QB_MOCK_INVALID: 400 };

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, error: "Please sign in." });
  let body: unknown;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const parsed = parseMockExportRequest(body);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.error });
  const q = parsed.value;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("qb_mock_export", { p_exam: q.examId, p_version: q.versionId, p_class: q.classId, p_student: q.studentId, p_question: q.questionId, p_state: q.state, p_limit: q.format === "json" ? 20 : 50000 });
  if (error) {
    const code = /(QB_[A-Z_]+)/.exec(error.message)?.[1] ?? "";
    const status = STATUS[code] ?? (code in MESSAGES ? 400 : 500);
    if (!(code in MESSAGES)) console.error(`[mock-export] ${error.message.slice(0, 160)}`);
    return json(status, { ok: false, code, error: code in MESSAGES ? MESSAGES[code] : "We could not prepare that export. Please try again." });
  }
  const result = data as ExportData;
  if (q.format === "json") return json(200, { ok: true, ...result });
  const name = mockExportFileName(result.label, q.format);
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Export-Rows": String(result.rows.length), "X-Export-Total": String(result.total) };
  if (q.format === "csv") return new NextResponse(toCsv(result), { status: 200, headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  return new NextResponse(new Uint8Array(toXlsx(result, { category: result.label })), { status: 200, headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
}
