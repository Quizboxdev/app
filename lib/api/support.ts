import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Support requests from the browser (migration 20261038100000). People see only their own; staff see all. Every call is checked again in the database; files and emails go through /api/support/*.
export const CATEGORIES = { account: "My account or sign-in", payment: "Payment, Coins or refund", class: "Classes and assignments", challenge: "Challenges and competitions", content: "A question or content problem", other: "Something else" } as const;
export const STATUS = { open: "Open", waiting_for_user: "Waiting for your reply", resolved: "Resolved", closed: "Closed" } as const;
export type Category = keyof typeof CATEGORIES;
export type Status = keyof typeof STATUS;
export type MyRequest = { id: string; reference: string; subject: string; category: Category; status: Status; created_at: string; last_message_at: string };
export type FileRef = { id: string; file_name: string; mime: string; size_bytes: number };
export type Message = { id: string; author_kind: "requester" | "staff"; body: string; internal: boolean; created_at: string; files: FileRef[] };
export type RequestDetail = {
  request: { id: string; reference: string; subject: string; category: Category; status: Status; priority: "low" | "normal" | "high"; requester_name: string; requester_email: string; context: string; source: string; assigned_to: string | null; created_at: string; mine: boolean; staff_view: boolean };
  messages: Message[]; loose_files: FileRef[];
};
export type AdminRow = { id: string; reference: string; subject: string; category: Category; status: Status; priority: "low" | "normal" | "high"; requester: string; email: string; signed_in: boolean; source: string; created_at: string; last_message_at: string; messages: number };

const MESSAGES: Record<string, string> = {
  QB_SUPPORT_INVALID: "Please check what you wrote: a short subject, and a message of at least 10 characters.",
  QB_RATE_LIMITED: "You have sent a lot of messages in a short time. Please wait a little and try again.",
  QB_NOT_FOUND: "We could not find that request.",
  QB_SUPPORT_CLOSED: "This request is closed. Please open a new one.",
  QB_FORBIDDEN: "Only support staff can do that.",
  QB_SUPPORT_NOT_RESOLVED: "Resolve or close the request before deleting it.",
};
const friendly = (message: string) => MESSAGES[/(QB_[A-Z_]+)/.exec(message)?.[1] ?? ""] ?? "That did not work. Please try again.";
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => { if (error) throw new Error(friendly(error.message)); return data as T; });
async function token() { const { data } = await getSupabaseBrowserClient().auth.getSession(); if (!data.session) throw new Error("Please sign in again."); return data.session.access_token; }
async function call(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "That did not work. Please try again.");
  return body;
}
const notify = (event: "created" | "replied" | "staff_replied", requestId: string) => call("/api/support/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, requestId }) }).catch(() => undefined);   // email is best effort

export const myRequests = () => rpc<MyRequest[]>("qb_support_my_requests");
export const requestDetail = (id: string) => rpc<RequestDetail>("qb_support_request_get", { p_id: id });
export async function createRequest(category: Category, subject: string, message: string, context = "", files: File[] = []): Promise<{ id: string; reference: string; filesFailed: boolean }> {
  const made = await rpc<{ id: string; reference: string }>("qb_support_create", { p_category: category, p_subject: subject, p_message: message, p_context: context });
  let filesFailed = false;
  if (files.length) { try { await uploadFiles(made.id, files); } catch { filesFailed = true; } }
  void notify("created", made.id);
  return { ...made, filesFailed };
}
export async function replyToRequest(id: string, body: string, files: File[] = []): Promise<void> {
  await rpc("qb_support_reply", { p_id: id, p_body: body });
  if (files.length) await uploadFiles(id, files);
  void notify("replied", id);
}
export async function uploadFiles(requestId: string, files: File[]): Promise<void> {
  const form = new FormData(); form.append("requestId", requestId); files.forEach((f) => form.append("files", f));
  await call("/api/support/upload", { method: "POST", body: form });
}
export async function openFile(fileId: string): Promise<void> {
  const r = await call(`/api/support/file?id=${encodeURIComponent(fileId)}`, { method: "GET" });
  window.open(r.url, "_blank", "noopener,noreferrer");
}

export const adminRequests = (status: string | null) => rpc<AdminRow[]>("qb_support_admin_list", { p_status: status, p_limit: 200 });
export async function staffReply(id: string, body: string, internal: boolean, status: Status | null, files: File[] = []): Promise<void> {
  await rpc("qb_support_staff_reply", { p_id: id, p_body: body, p_internal: internal, p_status: status });
  if (files.length) await uploadFiles(id, files);
  if (!internal) void notify("staff_replied", id);
}
export const setRequest = (id: string, status: Status, priority: string, assignee: string | null) => rpc("qb_support_set", { p_id: id, p_status: status, p_priority: priority, p_assignee: assignee });
export const deleteRequest = (id: string) => call("/api/support/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: id }) });
