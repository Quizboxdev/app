import { getAdminDashboard, type Dash } from "@/lib/admin/dashboard";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Admin live figures (migration 20261125100000). Three sections are asked for separately, so a slow one never holds back the others.
// Where the migration is not applied yet, the older single call (qb_admin_dashboard) fills the same sections, with only the few tab counts it already had.
export type SectionName = "queues" | "people" | "content";
export type PeopleData = Pick<Dash, "users" | "learning" | "markets">;
export type ContentData = { content: Dash["content"] };
export type QueueData = Record<string, number | null>;
export type SectionData = { queues: QueueData; people: PeopleData; content: ContentData };
// asOf is when the figures were calculated, on this device's clock (so a wrong clock does not make them look old).
export type Live<S extends SectionName> = { data: SectionData[S]; asOf: number; stale: boolean; basic?: boolean };

// How often each section is asked for while the page is visible.
export const POLL_MS: Record<SectionName, number> = { queues: 30_000, people: 60_000, content: 120_000 };
export const TIMEOUT_MS = 12_000;

const missing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function[^]*qb_admin_live/i.test(e.message ?? "");
const failure = (message: string) => new Error(/QB_FORBIDDEN/.test(message) ? "Only staff can see the dashboard." : "These figures could not be loaded.");

// The older call answers all sections at once, so the three requests share one answer instead of running it three times.
let shared: { days: number; at: number; call: Promise<Dash> } | null = null;
function olderCall(days: number, maxAge: number): Promise<Dash> {
  if (!shared || shared.days !== days || Date.now() - shared.at > maxAge * 1000) {
    const mine = { days, at: Date.now(), call: getAdminDashboard(days) };
    mine.call.catch(() => { if (shared === mine) shared = null; });
    shared = mine;
  }
  return shared.call;
}

async function basic<S extends SectionName>(section: S, days: number, maxAge = 60): Promise<Live<S>> {
  const d = await olderCall(days, maxAge);
  const data: SectionData[SectionName] = section === "people" ? { users: d.users, learning: d.learning, markets: d.markets }
    : section === "content" ? { content: d.content }
      : {
        support_open: d.queues?.support_open ?? null, support_waiting_for_user: d.queues?.support_waiting_for_user ?? null, support_new_7d: d.queues?.support_new_7d ?? null,
        schools_waiting: d.schools?.waiting ?? null, schools_listed: d.schools?.listed ?? null,
        markets_active: d.markets ? (d.markets.ACTIVE ?? 0) : null, markets_setting_up: d.markets ? (d.markets.CONFIGURING ?? 0) : null,
      };
  return { data: data as SectionData[S], asOf: shared?.at ?? Date.now(), stale: false, basic: true };
}

export async function fetchLive<S extends SectionName>(section: S, days: number, maxAge?: number): Promise<Live<S>> {
  const { data, error } = await getSupabaseBrowserClient()
    .rpc("qb_admin_live", { p_section: section, p_days: days, p_max_age: maxAge ?? null })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) {
    if (missing(error)) return basic(section, days, maxAge);
    throw failure(error.message ?? "");
  }
  const r = data as { data: SectionData[S]; age_seconds: number; stale: boolean };
  return { data: r.data, asOf: Date.now() - r.age_seconds * 1000, stale: r.stale };
}

// One tile for every count qb_admin_live returns. `action` tiles are listed under "Needs attention" when above zero; the others are for information.
export type Tile = { key: string; area: Area; label: string; href: string; action?: boolean };
export const AREAS = ["Markets & organizations", "Content & curriculum", "Competitions", "SME & payments", "Operations"] as const;
export type Area = (typeof AREAS)[number];
const t = (area: Area, key: string, label: string, href: string, action = false): Tile => ({ area, key, label, href, action });
const [MARKETS, CONTENT, COMPETE, PAY, OPS] = AREAS;

export const TILES: Tile[] = [
  t(MARKETS, "markets_active", "Active markets", "/admin/markets"),
  t(MARKETS, "markets_setting_up", "Markets being set up", "/admin/market-setup", true),
  t(MARKETS, "schools_waiting", "Schools waiting for review", "/admin/schools", true),
  t(MARKETS, "schools_listed", "Schools listed", "/admin/schools"),
  t(MARKETS, "partners_waiting", "Partners waiting for verification", "/admin/partners", true),
  t(MARKETS, "sponsors_waiting", "Sponsors waiting for verification", "/admin/sponsor-verification", true),
  t(CONTENT, "source_issues", "Source issues to resolve", "/admin/curriculum-sources", true),
  t(CONTENT, "source_imports_waiting", "Source imports not finished", "/admin/curriculum-sources", true),
  t(CONTENT, "loads_failed_7d", "Question loads failed, 7 days", "/admin/question-loading", true),
  t(CONTENT, "topics_draft", "Draft topics", "/admin/topics"),
  t(CONTENT, "factory_running", "Factory campaigns running", "/admin/content-factory"),
  t(CONTENT, "factory_failed_7d", "Factory jobs failed, 7 days", "/admin/content-factory", true),
  t(CONTENT, "question_reports_open", "Question reports open", "/admin/quality", true),
  t(CONTENT, "listings_waiting", "Marketplace sets waiting", "/admin/marketplace", true),
  t(CONTENT, "sellers_waiting", "Sellers waiting", "/admin/marketplace", true),
  t(COMPETE, "challenges_live", "Challenges live", "/creator"),
  t(COMPETE, "challenge_reports_open", "Challenge reports open", "/admin/challenge-reports", true),
  t(COMPETE, "prizes_waiting", "Prizes waiting to be given", "/admin/challenge-reports", true),
  t(COMPETE, "competition_reviews_waiting", "Competition questions in review", "/admin/competitions"),
  t(COMPETE, "competition_jobs_failed_7d", "Competition jobs failed, 7 days", "/admin/competitions", true),
  t(PAY, "reviewer_applications", "Reviewer applications", "/admin/reviewer-applications", true),
  t(PAY, "reviewers_verified", "Verified reviewers", "/admin/reviewers"),
  t(PAY, "sme_reviews_open", "SME reviews in progress", "/admin/sme-workforce"),
  t(PAY, "compensation_unresolved", "Compensation to resolve", "/admin/compensation", true),
  t(PAY, "sme_payouts_waiting", "SME payout batches to finish", "/admin/payouts", true),
  t(PAY, "seller_payouts_requested", "Seller payouts requested", "/admin/marketplace", true),
  t(PAY, "payments_mismatched", "Payments that do not match", "/admin/payment-checks", true),
  t(PAY, "payments_open_old", "Payments open over 1 hour", "/admin/payment-checks"),
  t(PAY, "payments_successful_24h", "Successful payments, 24 hours", "/admin/payment-checks"),
  t(PAY, "refunds_open", "Refunds to finish", "/admin/refunds", true),
  t(PAY, "affiliates_waiting", "Affiliate applications", "/admin/affiliates", true),
  t(OPS, "support_open", "Support requests open", "/admin/support", true),
  t(OPS, "support_waiting_for_user", "Support waiting for the person", "/admin/tickets"),
  t(OPS, "support_new_7d", "New support requests, 7 days", "/admin/tickets"),
  t(OPS, "enquiries_new", "New enquiries", "/admin/inbox", true),
  t(OPS, "client_errors_24h", "Page errors, 24 hours", "/admin/operations"),
  t(OPS, "server_errors_24h", "Server errors, 24 hours", "/admin/operations", true),
  t(OPS, "notifications_failed", "Notifications that failed", "/admin/operations"),
  t(OPS, "erasures_due", "Young learner records due for erasure", "/admin/young-learners", true),
  t(OPS, "family_applications_waiting", "Family applications waiting", "/admin/families", true),
  t(OPS, "subscriptions_active", "Active subscriptions", "/admin/access"),
  t(OPS, "staff_members", "Staff with admin duties", "/admin/staff"),
  t(OPS, "help_drafts", "Help drafts", "/admin/help"),
  t(OPS, "posts_published", "Posts published", "/admin/posts"),
  t(OPS, "posts_draft", "Post drafts", "/admin/posts"),
  t(OPS, "policy_drafts", "Policy drafts", "/admin/policies"),
  t(OPS, "social_channels", "Social channels", "/admin/social"),
];
