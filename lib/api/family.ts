import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Family workspace calls from the browser. Anything that needs the service role (creating a child's sign-in, resetting access) goes through a server route; everything else is a
// database call that checks the parent's relationship to the child itself.
export type FamilyChild = { student_id: string | null; relationship_id: string; relationship_type: string; status: "active" | "requested" | "pending_verification"; permissions: Record<string, boolean>; full_name: string | null; grade_code: string | null; school_name: string | null; label: string | null };
export type NewChild = { firstName: string; lastName?: string; displayName?: string; age: number; gradeCode: string; school?: string };
export type ChildLink = { studentId: string; username: string; token: string | null; expiresAt?: string; note?: string };

const MESSAGES: Record<string, string> = {
  QB_AUTH_REQUIRED: "Please sign in.", QB_FEATURE_DISABLED: "The Family workspace is not open yet.", QB_FAMILY_FORBIDDEN: "You can only do that for your own children.",
  QB_FAMILY_NOT_ADULT: "Only an adult account can use the Family workspace.", QB_FAMILY_INVALID: "Check what you typed and try again.", QB_RATE_LIMITED: "You have sent a lot of requests today. Please wait for the answers first.",
};
const message = (e: { message?: string }) => MESSAGES[/(QB_[A-Z_]+)/.exec(e.message ?? "")?.[1] ?? ""] ?? "That did not work. Please try again.";
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => { if (error) throw new Error(message(error)); return data as T; });

const token = async () => { const { data } = await getSupabaseBrowserClient().auth.getSession(); if (!data.session?.access_token) throw new Error("Please sign in again."); return data.session.access_token; };
async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(typeof out?.error === "string" ? out.error : "Something went wrong. Please try again.");
  return out as T;
}

export const openFamilyWorkspace = (name?: string) => rpc<{ id: string; name: string }>("qb_family_open", { p_name: name ?? null });
export const listFamilyChildren = () => rpc<FamilyChild[]>("qb_family_children");
export const addChild = (c: NewChild) => post<ChildLink & { ok: true }>("/api/family/children", { ...c, consentConfirmed: true });
export const resendInvitation = (studentId: string) => rpc<{ token: string; expires_at: string }>("qb_family_invite_issue", { p_student: studentId });
export const revokeInvitation = (studentId: string) => rpc<{ revoked: number }>("qb_family_invite_revoke", { p_student: studentId });
export const resetChildAccess = (studentId: string) => post<{ ok: true; token: string; expiresAt: string }>("/api/family/children/reset-access", { studentId });
export const unlinkChild = (studentId: string) => rpc<{ revoked: number }>("qb_family_revoke", { p_student: studentId });
export const requestLink = (email: string) => rpc<{ ok: true }>("qb_family_link_request", { p_email: email });

export type LinkRequest = { id: string; parent_name: string; relationship_type: string; created_at: string };
export const myLinkRequests = () => rpc<LinkRequest[]>("qb_family_my_requests");
export const answerLinkRequest = (id: string, accept: boolean) => rpc<{ accepted: boolean }>("qb_family_link_respond", { p_relationship: id, p_accept: accept });

export const joinUrl = (origin: string, tokenValue: string) => `${origin.replace(/\/$/, "")}/join/${tokenValue}`;
