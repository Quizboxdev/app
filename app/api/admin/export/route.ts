import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { exportFileName, toCsv, toXlsx, type ExportData } from "@/lib/exports/file";
import { dayStart, nextDayStart, parseExportRequest } from "@/lib/exports/request";

// Admin data export. The caller's own session decides what they may export: the database function checks their role for the dataset, limits the rows, and writes a real export to the audit log.
// format "json" returns a short preview (and the total) for the screen; "csv" and "xlsx" return the file.
export const runtime = "nodejs";
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MESSAGES: Record<string, [number, string]> = {
  QB_FORBIDDEN: [403, "You do not have permission to export that."], QB_AUTHENTICATION_REQUIRED: [401, "Please sign in."],
  QB_INVALID_RANGE: [400, "The end date must not be before the start date."], QB_INVALID_CATEGORY: [400, "Choose a category from the list."],
};

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, error: "Please sign in." });
  let body: unknown;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const parsed = parseExportRequest(body);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.error });
  const { dataset, from, to, category, format } = parsed.value;

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("qb_export_run", { p_dataset: dataset, p_from: from ? dayStart(from) : null, p_to: to ? nextDayStart(to) : null, p_category: category, p_limit: format === "json" ? 20 : 50000 });
  if (error) {
    const code = /(QB_[A-Z_]+)/.exec(error.message)?.[1] ?? "";
    const [status, message] = MESSAGES[code] ?? [500, "We could not prepare that export. Please try again."];
    if (!MESSAGES[code]) console.error(`[export] ${dataset} ${error.message.slice(0, 160)}`);
    return json(status, { ok: false, code, error: message });
  }
  const result = data as ExportData;
  if (format === "json") return json(200, { ok: true, ...result });
  const name = exportFileName(dataset, from, to, format);
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Export-Rows": String(result.rows.length), "X-Export-Total": String(result.total) };
  if (format === "csv") return new NextResponse(toCsv(result), { status: 200, headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  return new NextResponse(new Uint8Array(toXlsx(result, { from, to, category })), { status: 200, headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
}
