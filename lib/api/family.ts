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

// Giving work. The parent's family class (one per class level) is made on first use; the topic list, plan and publish are the same functions teachers use, called with that class.
export type FamilyClass = { class_id: string; grade_code: string; curriculum_id: string | null; learners: Array<{ user_id: string; name: string }> };
export type FamilyAssignment = { assignment_id: string; title: string; grade_code: string | null; due_at: string | null; published_at: string | null; question_count: number; mode: string; children: Array<{ student_id: string; name: string; status: "done" | "started" | "not_started"; percentage: number | null }> };
export const familyClassFor = (gradeCode: string) => rpc<FamilyClass>("qb_family_class", { p_grade_code: gradeCode });
export const listFamilyAssignments = () => rpc<FamilyAssignment[]>("qb_family_assignments");

// Coins and subscriptions for ticked children. One checkout pays for all of them; the server prices it and the database settles every child or none.
import { listPrices } from "@/lib/api/pricing";
import { getCatalog } from "@/lib/api/payments";
export type FamilyWallet = { student_id: string; name: string; coins: number; plan: string | null; valid_until: string | null; can_buy_coins: boolean; can_buy_subscription: boolean };
export type FamilyOrder = { reference: string; kind: "coins" | "subscription"; status: "initiated" | "paid" | "fulfilled" | "failed" | "refunded" | "mismatch"; total_minor: number; created_at: string; items: Array<{ student_id: string; name: string; coins: number; amount_minor: number }> };
export type LearnerPlan = { code: string; name: string; coins: number; days: number };
export const listFamilyWallets = () => rpc<FamilyWallet[]>("qb_family_wallets");
export const listFamilyOrders = () => rpc<FamilyOrder[]>("qb_family_orders");
export const getFamilyOrder = (reference: string) => rpc<FamilyOrder>("qb_family_order_get", { p_reference: reference });
export async function learnerPlans(): Promise<LearnerPlan[]> {
  const rows = await listPrices();
  return rows.filter((r) => r.kind === "plan" && r.audience === "learner" && Number(r.coins) > 0 && Number(r.days) > 0).map((r) => ({ code: r.code, name: r.name, coins: Number(r.coins), days: Number(r.days) })).sort((a, b) => a.days - b.days);
}
export const unitPriceMinor = async (): Promise<number> => Number((await getCatalog())?.unit_price_minor ?? 0);
export const cedis = (minor: number) => `GHS ${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export async function startFamilyOrder(kind: "coins" | "subscription", items: Array<{ studentId: string; coins?: number; planId?: string }>): Promise<{ url: string; reference: string }> {
  const res = await fetch("/api/family/orders", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ kind, items }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.url) throw new Error(typeof out?.error === "string" ? out.error : "We could not start the payment. Please try again.");
  return { url: String(out.url), reference: String(out.reference) };
}
