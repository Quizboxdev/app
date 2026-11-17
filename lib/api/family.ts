import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Family workspace calls from the browser. Anything that needs the service role (creating a child's sign-in, resetting access) goes through a server route; everything else is a
// database call that checks the parent's relationship to the child itself.
export type FamilyChild = { student_id: string | null; relationship_id: string; relationship_type: string; status: "active" | "requested" | "pending_verification"; permissions: Record<string, boolean>; full_name: string | null; grade_code: string | null; school_name: string | null; label: string | null };
export type NewChild = { firstName: string; lastName?: string; displayName?: string; age: number; gradeCode: string; school?: string };
export type ChildLink = { studentId: string; username: string; token: string | null; expiresAt?: string; note?: string };

const MESSAGES: Record<string, string> = {
  QB_AUTH_REQUIRED: "Please sign in.", QB_FEATURE_DISABLED: "The Family workspace is not open yet.", QB_FAMILY_FORBIDDEN: "You can only do that for your own children.",
  QB_FAMILY_NOT_ADULT: "Only an adult account can use the Family workspace.", QB_FAMILY_APPROVAL_REQUIRED: "Alumni sponsors need approval before creating a family. Apply for approval below.", QB_FAMILY_APPLICATION_EXISTS: "You already have an application.", QB_FAMILY_APPLICATION_NOT_NEEDED: "Only alumni sponsors need to apply.", QB_FORBIDDEN: "Only an approver can do that.", QB_FAMILY_INVALID: "Check what you typed and try again.", QB_RATE_LIMITED: "You have sent a lot of requests today. Please wait for the answers first.",
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

// What a parent can follow about a child, and what staff see across families (read-only).
export type ChildProgressLine = { student_id: string; name: string; grade_code: string | null; completed: number; average: number | null; outstanding: number; last_activity: string | null };
export type ChildProgress = { days: number; completed: number; average: number | null; best: number | null; outstanding: number; weekly: Array<{ week: string; completed: number; average: number | null }>; recent: Array<{ title: string; percentage: number | null; submitted_at: string; source: string | null }> };
export const listFamilyProgress = (days = 30) => rpc<ChildProgressLine[]>("qb_family_progress", { p_days: days });
export const childProgress = (studentId: string, days = 30) => rpc<ChildProgress>("qb_family_child_progress", { p_student: studentId, p_days: days });
export type AdminFamilies = { generated_at: string; workspaces: number; children_linked: number; requests_waiting: number; invitations_waiting: number; orders: Record<string, number>; paid_minor: number; family_assignments: number;
  families: Array<{ workspace_id: string; owner: string; email: string; created_at: string; children: number; orders: number; spent_minor: number; assignments: number }> };
export type AdminFamilyDetail = { workspace_id: string; name: string; created_at: string; owner: { name: string; email: string; role: string }; children: Array<{ student_id: string; name: string; grade_code: string | null; type: string; status: string; since: string; minor: boolean }>;
  orders: Array<{ reference: string; kind: string; status: string; total_minor: number; created_at: string }>; activity: Array<{ action: string; at: string; status: string }> };
export const adminFamilies = () => rpc<AdminFamilies>("qb_admin_families");
export const adminFamilyDetail = (workspaceId: string) => rpc<AdminFamilyDetail>("qb_admin_family_detail", { p_workspace: workspaceId });

// The family question library: sets a parent bought in the Marketplace, given to chosen children without copying anything.
import type { OpenSet } from "@/lib/api/marketplace";
export type LibrarySet = { item_id: string; title: string; subject: string; school: string; grade: string; expires_at: string; active: boolean; children: Array<{ student_id: string; name: string; best: number | null }> };
export type MySet = { item_id: string; title: string; subject: string; grade: string; from: string; expires_at: string; best: number | null };
export const familyLibrary = () => rpc<LibrarySet[]>("qb_family_library");
export const grantSet = (itemId: string, studentIds: string[]) => rpc<{ granted: number }>("qb_family_grant_set", { p_item: itemId, p_students: studentIds });
export const revokeSet = (itemId: string, studentId: string) => rpc<{ revoked: number }>("qb_family_revoke_grant", { p_item: itemId, p_student: studentId });
export const myFamilySets = () => rpc<MySet[]>("qb_family_my_sets");
export const openFamilySet = (itemId: string) => rpc<OpenSet>("qb_family_set_open", { p_item: itemId });
export const recordFamilySet = (itemId: string, correct: number, total: number) => rpc<void>("qb_family_set_record", { p_item: itemId, p_correct: correct, p_total: total });

// Challenges a parent made in Create and share, sent to chosen children.
export type FamilyChallenge = { campaign_id: string; slug: string; title: string; status: string; visibility: string; starts_at: string | null; ends_at: string | null; children: Array<{ student_id: string; name: string }> };
export type MyFamilyChallenge = { campaign_id: string; slug: string; title: string; ends_at: string | null; starts_at: string | null; access_code: string | null; from: string };
export const familyChallenges = () => rpc<FamilyChallenge[]>("qb_family_challenges");
export const inviteToChallenge = (campaignId: string, studentIds: string[]) => rpc<{ invited: number }>("qb_family_invite_challenge", { p_campaign: campaignId, p_students: studentIds });
export const uninviteFromChallenge = (campaignId: string, studentId: string) => rpc<{ removed: number }>("qb_family_uninvite_challenge", { p_campaign: campaignId, p_student: studentId });
export const myFamilyChallenges = () => rpc<MyFamilyChallenge[]>("qb_family_my_challenges");

// Sponsor links to managed children: a guardian answers first; QuizBox staff answer when no guardian is linked.
export type GuardianRequest = { id: string; sponsor_name: string; child_name: string; child_grade: string | null; created_at: string };
export type StaffVerification = { id: string; sponsor_name: string; sponsor_email: string | null; child_name: string; child_grade: string | null; child_school: string | null; created_at: string };
export const guardianRequests = () => rpc<GuardianRequest[]>("qb_family_guardian_requests");
export const answerGuardianRequest = (id: string, accept: boolean) => rpc<{ accepted: boolean }>("qb_family_guardian_respond", { p_relationship: id, p_accept: accept });
export const staffVerifications = () => rpc<StaffVerification[]>("qb_family_staff_verifications");
export const decideStaffVerification = (id: string, approve: boolean) => rpc<{ approved: boolean }>("qb_family_staff_decide", { p_relationship: id, p_approve: approve });

// Alumni sponsors apply for approval to create a family; staff or the named school's administrator decide.
export type MyApplication = { required: boolean; application: { id: string; status: "submitted" | "approved" | "declined"; school_name: string; decision_note: string | null; created_at: string } | null };
export type PendingApplication = { id: string; applicant_name: string; applicant_email: string | null; school_name: string; matched_school: boolean; alumni_note: string; intended_students: string; created_at: string };
export const myFamilyApplication = () => rpc<MyApplication>("qb_family_my_application");
export const applyForFamily = (school: string, note: string, students: string) => rpc<{ id: string; matched_school: boolean }>("qb_family_apply", { p_school: school, p_note: note, p_students: students });
export const pendingFamilyApplications = () => rpc<PendingApplication[]>("qb_family_applications_pending");
export const decideFamilyApplication = (id: string, approve: boolean, note?: string) => rpc<{ approved: boolean }>("qb_family_application_decide", { p_id: id, p_approve: approve, p_note: note ?? null });
