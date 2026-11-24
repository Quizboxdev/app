import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import type { PostListItem, PostPublic } from "./presentation";

// Marketing posts read on the server for the public page and the sitemap. A failure is logged and treated as "no post" instead of breaking the page.
export async function getPost(slug: string): Promise<PostPublic | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null;
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("qb_post_get", { p_slug: slug });
    if (error) { console.error(`[posts] ${slug} not read:`, `${error.code ?? ""} ${error.message}`.trim()); return null; }
    return (data ?? null) as PostPublic | null;
  } catch (e) { console.error(`[posts] ${slug} unavailable:`, e instanceof Error ? e.message : "unknown error"); return null; }
}
export async function listPosts(): Promise<PostListItem[]> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("qb_post_list");
    if (error) { console.error("[posts] list not read:", `${error.code ?? ""} ${error.message}`.trim()); return []; }
    return (data ?? []) as PostListItem[];
  } catch (e) { console.error("[posts] list unavailable:", e instanceof Error ? e.message : "unknown error"); return []; }
}
