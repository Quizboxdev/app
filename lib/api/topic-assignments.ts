import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { describeErrorMessage } from "@/lib/errors";

export type TeacherTopic = {
  topic_id: string; title: string; subject: string; grade: string;
  indicator_code: string; indicator: string; concepts: string[]; available: number; easy: number; medium: number; hard: number;
};
export type TopicShare = { topic_id: string; title: string; share: number; available: number; easy: number; medium: number; hard: number };
export type TopicPlan = { total: number; shares: TopicShare[] };

// Keeps the server's detail (which topic is short) in the message; the code is turned into plain language.
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(describeErrorMessage(error.message));
  return data as T;
}
export const listTeacherTopics = (classId: string, subject?: string) => call<TeacherTopic[]>("qb_teacher_topics", { p_class_id: classId, p_subject: subject ?? null });
export const previewTopicPlan = (classId: string, topicIds: string[], total: number, difficulty?: string) =>
  call<TopicPlan>("qb_topic_assignment_plan", { p_class_id: classId, p_topic_ids: topicIds, p_total: total, p_difficulty: difficulty || null });
export const publishTopicAssignment = (args: {
  classId: string; title: string; description: string; topicIds: string[]; total: number; difficulty?: string; mode: "PRACTICE" | "ASSESSMENT";
  attempts: number; minutes: number; startAt?: string; dueAt?: string; targetStudentIds?: string[];
}) => call<{ assignment_id: string; topics: TopicShare[] }>("qb_publish_topic_assignment", {
  p_class_id: args.classId, p_title: args.title, p_description: args.description, p_topic_ids: args.topicIds, p_total: args.total, p_difficulty: args.difficulty || null,
  p_mode: args.mode, p_attempts_allowed: args.attempts, p_time_limit_minutes: args.minutes, p_start_at: args.startAt ?? new Date().toISOString(),
  p_due_at: args.dueAt || null, p_target_student_ids: args.targetStudentIds?.length ? args.targetStudentIds : null,
});
export async function listClassLearners(classId: string): Promise<Array<{ user_id: string; name: string }>> {
  const { data, error } = await getSupabaseBrowserClient().from("class_memberships").select("student_user_id,student_name,status").eq("class_id", classId).eq("status", "active").order("student_name");
  if (error) throw new Error(describeErrorMessage(error.message));
  return (data ?? []).flatMap((r: { student_user_id?: string | null; student_name?: string | null }) => (r.student_user_id ? [{ user_id: r.student_user_id, name: r.student_name || "Learner" }] : []));
}
