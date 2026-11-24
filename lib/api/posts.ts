import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Marketing posts from the Admin screen (migration 20261124120000). Support staff only; the database checks every call.
export type AdminPost = { id: string; slug: string; title: string; state: "draft" | "published"; flyer_path: string | null; published_at: string | null; updated_at: string };
export type PostFull = AdminPost & { summary: string; body: string; flyer_alt: string | null };
export type PostInput = { id: string | null; slug: string; title: string; summary: string; body: string; flyer_path: string | null; flyer_alt: string };

const MESSAGES: Record<string, string> = {
  QB_FORBIDDEN: "Only support staff can manage posts.",
  QB_NOT_FOUND: "We could not find that post.",
  QB_POST_INVALID: "Check the post: a web name (letters, numbers and dashes), a title, a summary of 10 to 300 characters and a body of at least 50 characters.",
  QB_POST_SLUG_TAKEN: "Another post already uses that web name. Choose a different one.",
  QB_POST_UNPUBLISH_FIRST: "Switch the post back to draft before deleting it.",
};
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => {
  if (error) throw new Error(MESSAGES[/(QB_[A-Z_]+)/.exec(error.message)?.[1] ?? ""] ?? "That did not work. Please try again.");
  return data as T;
});
export const adminPosts = () => rpc<AdminPost[]>("qb_post_admin_list");
export const adminPost = (id: string) => rpc<PostFull>("qb_post_admin_get", { p_id: id });
export const savePost = (p: PostInput) => rpc<PostFull>("qb_post_save", { p_id: p.id, p_slug: p.slug, p_title: p.title, p_summary: p.summary, p_body: p.body, p_flyer_path: p.flyer_path, p_flyer_alt: p.flyer_alt });
export const setPostState = (id: string, state: "draft" | "published") => rpc<{ ok: boolean; state: string; slug: string }>("qb_post_set_state", { p_id: id, p_state: state });
export const deletePost = (id: string) => rpc<void>("qb_post_delete", { p_id: id });

// Uploads a flyer. The server checks it is a real PNG, JPEG or WebP image (up to 5 MB), re-saves it as PNG and returns the stored name.
export async function uploadFlyer(file: File): Promise<string> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const form = new FormData(); form.set("file", file);
  const res = await fetch("/api/admin/posts/flyer", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error === "QB_FORBIDDEN" ? MESSAGES.QB_FORBIDDEN : body.error === "QB_INVALID_MEDIA" ? "Use a PNG, JPEG or WebP image up to 5 MB and 4096 pixels on each side." : "The flyer could not be uploaded. Please try again.");
  return body.path as string;
}
