import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import type { ParsedPackage } from "@/lib/content/sources/package";

// Thin clients for the curriculum source registry. Country isolation and every governance rule are enforced in SQL.
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(userFacingError(error));
  return data as T;
}
export type SourceMarket = { market_id: string; market: string; status: string; is_test: boolean; country_id: string; country: string; iso2: string; curricula: Array<{ id: string; code: string; authority_id: string; authority: string; official_domains: string[]; active: boolean }> };
export type PreviewRow = { level: string; subject: string; subject_code: string | null; title: string; url: string; source_type: string; verification_status: string; curriculum: string | null; authority: string | null; issue: string | null };
export type PreviewGroup = { country: string; country_id: string | null; market_id: string | null; market: string | null; warnings: string[]; levels: string[]; curricula: Array<{ id: string; code: string; authority: string }>;
  totals: { sources: number; importable: number; verified_pdfs: number; index_only: number; pending: number; duplicates: number; warnings: number };
  summary: Array<{ authority: string | null; curriculum: string | null; level: string; subject: string; sources: number; verified_pdfs: number; index_only: number; pending: number; duplicates: number; warnings: string[] }> | null; rows: PreviewRow[] };
export type RegistryRow = { id: string; market: string; country: string; source_country: string | null; authority: string; curriculum: string; education_level: string; subject_code: string; title: string; canonical_url: string; source_type: string; verification_status: string; status: string; sha256: string | null; pages: number | null; last_error: string | null; review_note: string | null; package: string; updated_at: string };

export const sourceRegistry = <T = unknown>(action: string, data: Record<string, unknown> = {}) => call<T>("qb_curriculum_sources", { p_action: action, p_data: data });
export const previewPackage = (pkg: ParsedPackage, target: string | null, mapping: Record<string, Record<string, string>>) =>
  sourceRegistry<{ package_type: string; groups: PreviewGroup[] }>("preview", { package: pkg, target_market_id: target, mapping });
export const importPackage = (pkg: ParsedPackage, target: string | null, mapping: Record<string, Record<string, string>>) =>
  sourceRegistry<{ package_id: string; jobs: Array<{ country: string; market?: string; job_id?: string; status: string; imported?: number; skipped?: number; warnings?: string[] }> }>("import", { package: pkg, target_market_id: target, mapping, confirm: true });
export const factorySources = (market: string, curriculum: string) =>
  call<Array<{ id: string; title: string; level: string | null; subject: string | null; registry_status: string | null }>>("qb_content_factory_sources", { p_market: market, p_curriculum: curriculum });

// Bounded server-side fetch (at most 5 official PDFs per click).
export async function fetchSources(filter: { market_id?: string; job_id?: string; limit?: number }) {
  const supabase = getSupabaseBrowserClient(); const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error(userFacingError(new Error("AUTH_REQUIRED")));
  const response = await fetch("/api/admin/curriculum-sources/fetch", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(filter) });
  const body = await response.json(); if (!response.ok) throw new Error(userFacingError(new Error(body.error ?? "FETCH_FAILED")));
  return body as { claimed: number; outcomes: Array<{ id: string; title: string; status: string; error?: string; pages?: number }> };
}
