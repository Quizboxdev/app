import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { describeErrorMessage } from "@/lib/errors";

export type TopicGroup = { subject: string; grade: string; open: number; ready: number; not_ready: number; topics: number; approved_questions: number };
export type TopicChange = { changed: number; not_ready: number; opened: boolean };

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(describeErrorMessage(error.message));
  return data as T;
}

// Per subject and grade: topics open to teachers, topics ready to open, and topics still short of their question target.
export const topicsOverview = () => call<TopicGroup[]>("qb_topics_overview");
// Opens every ready topic (or withdraws the open ones) for a subject and grade, or for everything when both are left out.
export const setTopicsOpen = (open: boolean, subject?: string, grade?: string) =>
  call<TopicChange>("qb_topics_set_open", { p_open: open, p_subject: subject ?? null, p_grade: grade ?? null });
