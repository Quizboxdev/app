import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// The Help video library from the Admin screen (migration 20261123100000). Support staff only; the database checks every call.
export type AdminVideo = { id: string; title: string; summary: string; youtube_id: string; audiences: string[]; duration_seconds: number | null; sort_order: number; state: "draft" | "published"; plays: number; outbound: number; updated_at: string; slugs: string[] };

const MESSAGES: Record<string, string> = {
  QB_FORBIDDEN: "Only support staff can manage Help videos.",
  QB_NOT_FOUND: "We could not find that video.",
  QB_HELP_INVALID: "Check the video: a title of at least 3 letters, a YouTube link, a length of up to 2 hours if you give one, who it is for, and guides that exist.",
  QB_VIDEO_TAKEN: "That YouTube video is already in the library.",
  QB_HELP_UNPUBLISH_FIRST: "Switch the video back to draft before deleting it.",
};
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => {
  if (error) throw new Error(MESSAGES[/(QB_[A-Z_]+)/.exec(error.message)?.[1] ?? ""] ?? "That did not work. Please try again.");
  return data as T;
});
export const adminVideos = () => rpc<AdminVideo[]>("qb_help_video_admin_list");
export const saveVideo = (v: { id: string | null; title: string; summary: string; youtubeId: string; audiences: string[]; sort: number; duration: number | null; slugs: string[] }) =>
  rpc<AdminVideo>("qb_help_video_save", { p_id: v.id, p_title: v.title, p_summary: v.summary, p_youtube_id: v.youtubeId, p_audiences: v.audiences, p_sort: v.sort, p_duration: v.duration, p_slugs: v.slugs });
export const setVideoState = (id: string, state: "draft" | "published") => rpc<{ ok: boolean; state: string }>("qb_help_video_set_state", { p_id: id, p_state: state });
export const deleteVideo = (id: string) => rpc<void>("qb_help_video_delete", { p_id: id });
