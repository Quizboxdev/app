import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { plain } from "@/lib/interschool/text";
import { isNetworkFailure, NETWORK_ERROR_MESSAGE } from "@/lib/errors";
import type { AdminOverview, Billing, Certificate, Check, JoinOptions, ManageList, Managed, Mine, Operations, Registrations, Results, Roster, RoundConfig, SchoolHome, Settings, Sitting, SponsorHome } from "@/lib/interschool/types";

// Browser calls to the inter-school database functions. The database decides every permission, limit and score; this only asks and shows.
export class InterschoolError extends Error { constructor(message: string, readonly code: string, readonly detail?: string) { super(message); } }
const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await getSupabaseBrowserClient().rpc(fn, args);
  if (error) {
    if (isNetworkFailure(error.message)) throw new InterschoolError(NETWORK_ERROR_MESSAGE, "NETWORK");
    throw new InterschoolError(plain(error.message), /\b((?:IS|QB)_[A-Z_]+)\b/.exec(error.message)?.[1] ?? "", (error as { details?: string }).details);
  }
  return data as T;
};

export const manageList = () => rpc<ManageList>("interschool_manage_list");
export const manageGet = (id: string) => rpc<Managed>("interschool_manage_get", { p_id: id });
export const createCompetition = (settings: Partial<Settings>, host: string | null) => rpc<{ id: string; slug: string }>("interschool_create", { p_settings: settings, p_host: host });
export const updateCompetition = (id: string, patch: Partial<Settings>) => rpc("interschool_update", { p_id: id, p_patch: patch });
export const setDivisions = (id: string, divisions: Array<{ title: string; level_codes: string[]; mixed: boolean; capacity: number | null }>) => rpc("interschool_set_divisions", { p_id: id, p_divisions: divisions });
export const setRounds = (division: string, rounds: RoundConfig[]) => rpc("interschool_set_rounds", { p_division: division, p_rounds: rounds });
export const checkCompetition = (id: string) => rpc<Check>("interschool_check", { p_id: id });
export const requestApproval = (id: string) => rpc("interschool_request_approval", { p_id: id });
export const decideCompetition = (id: string, approve: boolean, note: string | null) => rpc("interschool_decide", { p_id: id, p_approve: approve, p_note: note });
export const publishCompetition = (id: string) => rpc<{ slug: string; papers_frozen: number }>("interschool_publish", { p_id: id });
export const setStatus = (id: string, status: string, reason: string | null = null) => rpc("interschool_set_status", { p_id: id, p_status: status, p_reason: reason });
export const duplicateCompetition = (id: string) => rpc<{ id: string }>("interschool_duplicate", { p_id: id });
export const setListed = (id: string, listed: boolean) => rpc("interschool_set_listed", { p_id: id, p_listed: listed });
export const subjectsFor = (levels: string[]) => rpc<Array<{ id: string; title: string; level: string; questions: number }>>("interschool_subjects", { p_levels: levels });
export const topicsFor = (subject: string, parent: string | null = null) => rpc<Array<{ id: string; title: string; code: string; type: string; questions: number }>>("interschool_topics", { p_subject: subject, p_parent: parent });

export const searchSchools = (query: string, region: string | null = null) => rpc<Array<{ id: string; name: string; region: string | null; district: string | null }>>("interschool_school_search", { p_query: query, p_region: region });
export const inviteSchools = (id: string, schools: string[]) => rpc<{ invited: number }>("interschool_invite", { p_id: id, p_institutions: schools });
export const registrations = (id: string) => rpc<Registrations>("interschool_registrations", { p_id: id });
export const schoolHome = () => rpc<SchoolHome>("interschool_school_home");
export const schoolRespond = (id: string, school: string, accept: boolean) => rpc<{ status: string }>("interschool_school_respond", { p_id: id, p_institution: school, p_accept: accept });
export const schoolRoster = (id: string, school: string) => rpc<Roster>("interschool_school_roster", { p_id: id, p_institution: school });
export const schoolLearners = (id: string, school: string, division: string, query: string) => rpc<Array<{ user_id: string; name: string; level: string }>>("interschool_school_learners", { p_id: id, p_institution: school, p_division: division, p_query: query || null });
export const nominate = (id: string, school: string, division: string, users: string[]) => rpc<{ results: Array<{ user_id: string; ok: boolean; status?: string; error?: string }> }>("interschool_nominate", { p_id: id, p_institution: school, p_division: division, p_users: users });
export const confirmCandidate = (candidate: string, approve: boolean) => rpc("interschool_confirm_candidate", { p_candidate: candidate, p_approve: approve });
export const withdrawCandidate = (candidate: string) => rpc("interschool_withdraw", { p_candidate: candidate });
export const replaceCandidate = (candidate: string, user: string) => rpc("interschool_replace", { p_candidate: candidate, p_new_user: user });
export const lockRoster = (id: string, school: string) => rpc("interschool_lock_roster", { p_id: id, p_institution: school });

export const joinOptions = (slug: string) => rpc<JoinOptions | null>("interschool_join_options", { p_slug: slug });
export const register = (slug: string, division: string, school: string | null, source: string) => rpc<{ status: string; already: boolean }>("interschool_register", { p_slug: slug, p_division: division, p_institution: school, p_source: source });
export const myCompetitions = () => rpc<Mine>("interschool_mine");
export const startRound = (round: string) => rpc<Sitting>("interschool_start", { p_round: round });
export const saveAnswers = (sitting: string, answers: Array<{ question_id: string; choice: number | null }>) => rpc<{ saved: boolean; expired?: boolean; submitted?: boolean }>("interschool_save", { p_sitting: sitting, p_answers: answers });
export const submitRound = (sitting: string, answers: Array<{ question_id: string; choice: number | null }>) => rpc<{ ok: boolean; answered: number; late_answers_ignored?: boolean; already_submitted?: boolean }>("interschool_submit", { p_sitting: sitting, p_answers: answers });

export const operations = (id: string) => rpc<Operations>("interschool_operations", { p_id: id });
export const generateFixtures = (division: string, method: string, groups = 1) => rpc<{ fixtures: number }>("interschool_generate_fixtures", { p_division: division, p_method: method, p_groups: groups });
export const addFixture = (round: string, home: string, away: string | null, from: string, to: string) => rpc("interschool_add_fixture", { p_round: round, p_home: home, p_away: away, p_from: from, p_to: to });
export const changeFixture = (fixture: string, change: { from?: string; to?: string; cancel?: boolean; reason?: string }) => rpc("interschool_change_fixture", { p_fixture: fixture, p_from: change.from ?? null, p_to: change.to ?? null, p_cancel: change.cancel ?? false, p_reason: change.reason ?? null });
export const finaliseRound = (round: string, force = false) => rpc<{ qualified: number; needs_manual_qualification: boolean; already?: boolean }>("interschool_finalise_round", { p_round: round, p_force: force });
export const qualify = (round: string, candidates: string[], qualified: boolean, reason: string) => rpc("interschool_qualify", { p_round: round, p_candidates: candidates, p_qualified: qualified, p_reason: reason });
export const announceRound = (round: string) => rpc("interschool_announce_round", { p_round: round });
export const roundResults = (round: string) => rpc<Results>("interschool_results", { p_round: round });
export const raiseDispute = (round: string, reason: string, candidate: string | null = null) => rpc("interschool_raise_dispute", { p_round: round, p_reason: reason, p_candidate: candidate });
export const resolveDispute = (dispute: string, upheld: boolean, resolution: string) => rpc("interschool_resolve_dispute", { p_dispute: dispute, p_upheld: upheld, p_resolution: resolution });
export const adjustScore = (round: string, candidate: string, score: number, reason: string) => rpc<{ qualifications_kept: boolean }>("interschool_adjust_score", { p_round: round, p_candidate: candidate, p_new_score: score, p_reason: reason });
export const disqualify = (candidate: string, reason: string) => rpc("interschool_disqualify", { p_candidate: candidate, p_reason: reason });

export const billing = (id: string) => rpc<Billing>("interschool_billing", { p_competition: id });
export const requestQuote = (id: string, input: { participants?: number | null; sponsor_name?: string | null; discount_minor?: number; discount_reason?: string | null } = {}) =>
  rpc("interschool_quote", { p_competition: id, p_participants: input.participants ?? null, p_sponsor_name: input.sponsor_name ?? null, p_discount_minor: input.discount_minor ?? 0, p_discount_reason: input.discount_reason ?? null });
export const decideQuote = (quote: string, accept: boolean) => rpc("interschool_decide_quote", { p_quote: quote, p_accept: accept });
export const fundInvoice = (invoice: string, action: "RECORD_PAYMENT" | "APPROVE_CREDIT" | "WAIVE" | "VOID", note: string) => rpc("interschool_fund_invoice", { p_invoice: invoice, p_action: action, p_note: note });
export const setRate = (rateMinor: number, setupMinor: number) => rpc("interschool_set_rate", { p_rate_minor: rateMinor, p_setup_fee_minor: setupMinor });
export const sponsorHome = () => rpc<SponsorHome>("interschool_sponsor_home");
// The server computes nothing from the browser: the amount comes from the invoice in the database.
export async function payInvoice(invoice: string): Promise<string> {
  const token = (await getSupabaseBrowserClient().auth.getSession()).data.session?.access_token;
  const response = await fetch("/api/interschool/pay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` }, body: JSON.stringify({ invoiceId: invoice }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) throw new InterschoolError(body.error ?? "We could not start the payment. Please try again.", body.code ?? "");
  return body.url as string;
}
export async function confirmInvoicePayment(reference: string): Promise<string> {
  const token = (await getSupabaseBrowserClient().auth.getSession()).data.session?.access_token;
  const response = await fetch("/api/payments/confirm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` }, body: JSON.stringify({ reference }) });
  return ((await response.json().catch(() => ({}))) as { state?: string }).state ?? "unknown";
}

export const issueCertificates = (id: string) => rpc<{ issued: number; total: number }>("interschool_issue_certificates", { p_competition: id });
export const revokeCertificate = (code: string, reason: string) => rpc("interschool_revoke_certificate", { p_code: code, p_reason: reason });
export const myCertificates = () => rpc<Certificate[]>("interschool_my_certificates");
export const adminOverview = () => rpc<AdminOverview>("interschool_admin_overview");
