import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Policies from the browser: the acknowledgement screen (everyone) and the Admin, Policies editor (owner and super admin, checked again in the database).
export type PendingPolicy = { version_id: string; slug: string; title: string; version_no: number; summary: string };
export type VersionRow = { id: string; version_no: number; state: "draft" | "published" | "superseded"; summary: string; effective_at: string | null; requires_reack: boolean; published_at: string | null; missing: string[] };
export type PolicyDoc = { id: string; slug: string; title: string; required: boolean; active: boolean; versions: VersionRow[] };
export type VersionFull = VersionRow & { document_id: string; body: string; resolved: string };
export type CompanyDetail = { key: string; label: string; value: string };

const MESSAGES: Record<string, string> = {
  QB_FORBIDDEN: "Only an owner or a super admin can manage policies.",
  QB_NOT_FOUND: "We could not find that.",
  QB_POLICY_TOO_SHORT: "The text is too short to publish. A policy needs at least a few paragraphs.",
  QB_POLICY_SUMMARY_REQUIRED: "Say what changed (a few words), so people can see why they are asked again.",
  QB_POLICY_NOT_DRAFT: "Only a draft can be published. Make a new draft to change the policy.",
  QB_POLICY_IMMUTABLE: "A published version can never be changed. Save a new version instead.",
  QB_POLICY_VARIABLE_IN_USE: "A live policy uses this detail, so it cannot be left empty.",
  QB_POLICY_TOO_LONG: "That is too long.",
  QB_INVALID_POLICY: "That policy is no longer the current version. Reload the page and try again.",
};
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => {
  if (error) {
    const missing = /QB_POLICY_VARIABLES_MISSING: ([a-z0-9_, ]+)/.exec(error.message)?.[1];
    if (missing) throw new Error(`Fill these in under Company details before publishing: ${missing.trim()}.`);
    const code = /(QB_[A-Z_]+)/.exec(error.message)?.[1] ?? "";
    throw new Error(MESSAGES[code] ?? "That did not work. Please try again.");
  }
  return data as T;
});

export const policyPending = () => rpc<PendingPolicy[]>("qb_policy_pending");
export const policyAccept = (versionIds: string[]) => rpc<{ ok: boolean; accepted: number }>("qb_policy_accept", { p_version_ids: versionIds });
export const myAcceptances = () => rpc<{ slug: string; title: string; version_no: number; accepted_at: string }[]>("qb_policy_my_acceptances");

export const adminPolicies = () => rpc<PolicyDoc[]>("qb_policy_admin_list");
export const adminVersion = (id: string) => rpc<VersionFull>("qb_policy_admin_get", { p_version: id });
export const saveDraft = (documentId: string, body: string, summary: string, effective: string | null, reack: boolean) =>
  rpc<{ id: string; version_no: number; missing: string[] }>("qb_policy_draft_save", { p_document: documentId, p_body: body, p_summary: summary, p_effective: effective, p_requires_reack: reack });
export const discardDraft = (id: string) => rpc<void>("qb_policy_draft_discard", { p_version: id });
export const publishVersion = (id: string) => rpc<{ ok: boolean; slug: string; version_no: number }>("qb_policy_publish", { p_version: id });
export const saveDocument = (slug: string, title: string, required: boolean, active: boolean, sort: number) => rpc<PolicyDoc>("qb_policy_document_save", { p_slug: slug, p_title: title, p_required: required, p_active: active, p_sort: sort });
export const companyDetails = () => rpc<CompanyDetail[]>("qb_company_details");
export const saveCompanyDetail = (key: string, value: string) => rpc<void>("qb_company_detail_save", { p_key: key, p_value: value });

// Turns a Word, PDF or text file into text for the editor. The file is not kept; the owner reviews the text and saves it as a draft.
export async function extractDocument(file: File): Promise<string> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const form = new FormData(); form.append("file", file);
  const res = await fetch("/api/admin/policies/extract", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body?.text !== "string") throw new Error(typeof body?.error === "string" ? body.error : "We could not read that file.");
  return body.text;
}
