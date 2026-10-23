import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Help guides from the Admin screen (migration 20261039100000). Support staff only; the database checks every call.
export type AdminGuide = { id: string; slug: string; title: string; category: string; audiences: string[]; state: "draft" | "published"; sort_order: number; views: number; helpful_yes: number; helpful_no: number; updated_at: string };
export type GuideFull = AdminGuide & { summary: string; body: string };

const MESSAGES: Record<string, string> = {
  QB_FORBIDDEN: "Only support staff can manage Help guides.",
  QB_NOT_FOUND: "We could not find that guide.",
  QB_HELP_INVALID: "Check the guide: a short web name (letters, numbers and dashes), a title, a one-line summary of at least 10 characters, steps of at least 50 characters, and who it is for.",
  QB_HELP_SLUG_TAKEN: "Another guide already uses that web name. Choose a different one.",
  QB_HELP_UNPUBLISH_FIRST: "Switch the guide back to draft before deleting it.",
};
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => {
  if (error) throw new Error(MESSAGES[/(QB_[A-Z_]+)/.exec(error.message)?.[1] ?? ""] ?? "That did not work. Please try again.");
  return data as T;
});
export const adminGuides = () => rpc<AdminGuide[]>("qb_help_admin_list");
export const adminGuide = (id: string) => rpc<GuideFull>("qb_help_admin_get", { p_id: id });
export const saveGuide = (g: { id: string | null; slug: string; title: string; summary: string; body: string; category: string; audiences: string[]; sort: number }) =>
  rpc<GuideFull>("qb_help_save", { p_id: g.id, p_slug: g.slug, p_title: g.title, p_summary: g.summary, p_body: g.body, p_category: g.category, p_audiences: g.audiences, p_sort: g.sort });
export const setGuideState = (id: string, state: "draft" | "published") => rpc<{ ok: boolean; state: string }>("qb_help_set_state", { p_id: id, p_state: state });
export const deleteGuide = (id: string) => rpc<void>("qb_help_delete", { p_id: id });
