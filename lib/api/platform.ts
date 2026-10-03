import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

// Thin clients for server-derived platform endpoints. All authorization and aggregation is server-side.
async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(userFacingError(error));
  return data as T;
}

export type HomeItem = { title: string; subtitle?: string; meta?: string; href?: string };
export type HomeSection = { key: string; title: string; kind: "stats" | "list"; stats?: Array<{ label: string; value: string | number }>; items?: HomeItem[]; empty?: string; href?: string; actions?: Array<{ label: string; href: string }> };
export type Home = { role: string; market: string | null; locale: string | null; currency: string | null; sections: HomeSection[] };
export type Notice = { id: string; type: string; title: string; message: string; link: string | null; created_at: string; read: boolean; live: boolean; market?: string | null };
export type SearchHit = { kind: string; title: string; subtitle?: string; href: string };

export const getHome = () => call<Home>("qb_home");
export const listNotifications = (unreadOnly = false) => call<{ unread: number; live: Notice[]; items: Notice[] }>("qb_notifications", { p_action: "list", p_data: { unread_only: unreadOnly } });
export const markNotificationRead = (id: string) => call("qb_notifications", { p_action: "mark_read", p_data: { id } });
export const markAllNotificationsRead = () => call("qb_notifications", { p_action: "mark_all_read", p_data: {} });
export const search = (query: string) => call<SearchHit[]>("qb_search", { p_query: query, p_limit: 8 });
export const contentQuality = <T>(action: string, data: Record<string, unknown> = {}) => call<T>("qb_content_quality", { p_action: action, p_data: data });
export const reportQuestion = (question: string, reason: string) => call("qb_report_question", { p_question: question, p_reason: reason });
export const studentInsights = () => call<Record<string, any>>("qb_student_insights");
export const teacherInsights = () => call<Record<string, any>>("qb_teacher_insights");
export const platformInsights = () => call<Record<string, any>>("qb_platform_insights");
export const schoolAction = <T>(action: string, data: Record<string, unknown> = {}) => call<T>("qb_school", { p_action: action, p_data: data });
export const adminOps = <T>(action: string, data: Record<string, unknown> = {}) => call<T>("qb_admin_ops", { p_action: action, p_data: data });
export async function recordAuthFailure(code: string) { try { await getSupabaseBrowserClient().rpc("qb_auth_failure", { p_code: code }); } catch { /* monitoring must never block sign-in */ } }
