import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Admin data exports (migration 20261045100000). The database decides which datasets a person may export; the server route builds the CSV or Excel file.
export type ExportDataset = { key: string; label: string; group: string; date_label: string | null; category_label: string; categories: string[] | null; description: string };
export type ExportQuery = { dataset: string; from: string | null; to: string | null; category: string | null };
export type ExportPreview = { columns: string[]; rows: unknown[][]; total: number; truncated: boolean; label: string };

export async function exportCatalog(): Promise<ExportDataset[]> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_export_catalog");
  if (error) throw new Error("We could not load the list of exports.");
  return (data ?? []) as ExportDataset[];
}

async function post(q: ExportQuery, format: "json" | "csv" | "xlsx"): Promise<Response> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in.");
  return fetch("/api/admin/export", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...q, format }) });
}
const failure = async (res: Response) => { const b = await res.json().catch(() => ({})); return new Error(typeof b?.error === "string" ? b.error : "We could not prepare that export. Please try again."); };

export async function previewExport(q: ExportQuery): Promise<ExportPreview> {
  const res = await post(q, "json");
  if (!res.ok) throw await failure(res);
  return (await res.json()) as ExportPreview;
}

// Downloads the file through the browser. Returns how many rows it holds and how many matched (they differ when the row limit cut it short).
export async function downloadExport(q: ExportQuery, format: "csv" | "xlsx"): Promise<{ rows: number; total: number }> {
  const res = await post(q, format);
  if (!res.ok) throw await failure(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `quizbox-export.${format}`;
  const blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { rows: Number(res.headers.get("x-export-rows") ?? 0), total: Number(res.headers.get("x-export-total") ?? 0) };
}
