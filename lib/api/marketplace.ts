import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// The Marketplace (migration 20261043100000). Teachers sell end-of-term question sets; buyers keep a set for 90 days; each sale is split 60% teacher / 40% QuizBox.
// The database decides every price, split, hold and payout amount; this file only asks and shows. Money moves through the normal Paystack checkout (/api/marketplace/checkout).
export type Listing = { slug: string; title: string; subject: string; grade: string; term: string | null; school: string; price_minor: number; questions: number; seller: string; purchases: number; summary: string };
export type ListingDetail = Listing & { id: string; description: string; samples: string[]; access_days: number; mine: boolean; owned_until: string | null };
export type Seller = { id: string; display_name: string; school_name: string; phone: string; payout_method: "mobile_money" | "bank"; payout_network: string; payout_account_masked: string; payout_account_name: string;
  status: "pending" | "verified" | "suspended"; review_note: string; terms_accepted: boolean; enabled: boolean };
export type SellerInput = { display_name: string; school: string; phone: string; method: "mobile_money" | "bank"; network: string; account: string; account_name: string; accept_terms: boolean };
export type MyItem = { id: string; slug: string; title: string; subject: string; grade: string; term: string | null; school_name: string; price_minor: number; status: "draft" | "submitted" | "approved" | "rejected" | "unlisted";
  review_note: string; question_count: number; updated_at: string; sales: number; gross_minor: number; share_minor: number };
export type ItemInput = { id: string | null; title: string; description: string; subject: string; grade: string; term: string; school: string; price_minor: number };
export type QuestionInput = { question_text: string; options: string[]; correct_index: number; explanation?: string };
export type ItemDetail = MyItem & { description: string; questions: QuestionInput[] };
export type Sale = { item: string; school: string; subject: string; price_minor: number; share_minor: number; fee_minor: number; status: "active" | "reversed"; purchased_at: string };
export type SellerSummary = { status: string; available_minor: number; in_hold_minor: number; requested_minor: number; paid_minor: number; sales: number; gross_minor: number; share_minor: number; fee_minor: number; share_percent: number; hold_days: number; min_payout_minor: number };
export type PayoutQuote = { amount_minor: number; sales_count: number; gross_minor: number; platform_fee_minor: number; refunds_minor: number; adjustments_minor: number; share_percent: number; min_payout_minor: number; can_request: boolean;
  destination: { method: string; network: string; account_masked: string; name: string } };
export type Payout = { id: string; amount_minor: number; gross_minor: number; platform_fee_minor: number; refunds_minor: number; sales_count: number; status: "requested" | "paid" | "rejected" | "cancelled"; requested_at: string; due_at: string; paid_at: string | null; transfer_ref: string | null; note: string };
export type Purchase = { item_id: string; slug: string; title: string; subject: string; school: string; grade: string; price_minor: number; purchased_at: string; expires_at: string; active: boolean; days_left: number; status: string };
export type OpenSet = { title: string; subject: string; school: string; grade: string; term: string | null; expires_at: string | null; questions: (QuestionInput & { id: string })[] };
export type AdminItem = { id: string; slug: string; title: string; subject: string; grade: string; term: string | null; school: string; price_minor: number; status: string; questions: number; duplicates: number; seller: string; seller_status: string; purchases: number; updated_at: string };
export type AdminItemDetail = { id: string; title: string; description: string; subject: string; grade: string; term: string | null; school_name: string; price_minor: number; status: string; dup_matches: number; review_note: string; seller: { name: string; school: string; status: string };
  questions: (QuestionInput & { duplicate: boolean })[] };
export type AdminSeller = { id: string; display_name: string; school: string; phone: string; status: string; review_note: string; method: string; network: string; account_masked: string; account_name: string; email: string; items: number; created_at: string };
export type AdminPayout = { id: string; seller: string; school: string; email: string; amount_minor: number; gross_minor: number; platform_fee_minor: number; refunds_minor: number; sales_count: number; status: string; requested_at: string; due_at: string; overdue: boolean; paid_at: string | null; transfer_ref: string | null;
  destination: { method: string; network: string; account: string; name: string; phone: string }; note: string };
export type AdminSummary = { gross_minor: number; platform_fee_minor: number; seller_share_minor: number; sales_count: number; refunded_minor: number; refunded_count: number; owed_to_sellers_minor: number; payouts_requested_minor: number; payouts_requested_count: number;
  payouts_overdue_count: number; paid_out_minor: number; items: Record<string, number>; sellers: Record<string, number> };

export const SUBJECT_SUGGESTIONS = ["Mathematics", "English Language", "Integrated Science", "Science", "Social Studies", "Chemistry", "Physics", "Biology", "Elective Mathematics", "Economics", "Geography", "Government", "History", "ICT", "French", "Religious and Moral Education", "Creative Arts", "Our World Our People"];
export const GRADE_OPTIONS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "SHS1", "SHS2", "SHS3"];
export const TERM_OPTIONS = ["Term 1", "Term 2", "Term 3"];
export const ITEM_STATUS: Record<string, string> = { draft: "Draft", submitted: "Waiting for review", approved: "On sale", rejected: "Needs changes", unlisted: "Off sale" };
export const PAYOUT_STATUS: Record<string, string> = { requested: "Waiting to be paid", paid: "Paid", rejected: "Not paid", cancelled: "Cancelled" };

// "Chemistry · Opoku Ware School · SHS1 · Term 2": the source line shown on every listing.
export const sourceLine = (x: { subject: string; school?: string; school_name?: string; grade?: string; term?: string | null }) => [x.subject, x.school ?? x.school_name, x.grade, x.term].filter(Boolean).join(" · ");
export const cedis = (minor: number) => `GHS ${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
export const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "");

const MESSAGES: Record<string, string> = {
  QB_AUTHENTICATION_REQUIRED: "Please sign in.", QB_FORBIDDEN: "You do not have permission to do that.", QB_NOT_FOUND: "We could not find that.", QB_NOT_A_SELLER: "Set up your seller account first.",
  QB_TEACHERS_ONLY: "Only teachers can sell question sets.", QB_TERMS_REQUIRED: "Please accept the seller terms.", QB_SELLER_INVALID: "Check your details. The phone and account numbers must be digits, and names need at least 2 letters.",
  QB_SELLER_SUSPENDED: "Your seller account is paused. Please contact support.", QB_SELLER_NOT_VERIFIED: "Your seller account has not been verified yet. We will tell you when it is.",
  QB_PRICE_INVALID: "The price must be a whole number of cedis between GHS 5 and GHS 200.", QB_ITEM_INVALID: "Check the title, subject, class and school.", QB_ITEM_LOCKED: "This set is on sale or waiting for review. Take it off sale to change it.",
  QB_QUESTIONS_INVALID: "Each question needs 2 to 5 different answers and one correct answer.", QB_QUESTIONS_DUPLICATE: "The same question appears twice.", QB_TOO_FEW_QUESTIONS: "Add more questions before sending the set for review.",
  QB_PAYOUT_BELOW_MINIMUM: "You have not reached the smallest payout yet.", QB_PAYOUT_ALREADY_REQUESTED: "You already have a payout waiting to be paid.", QB_QUOTE_CHANGED: "Your balance changed. Please look at the new amount and approve again.",
  QB_PAYOUT_NOT_OPEN: "That payout has already been dealt with.", QB_REASON_REQUIRED: "Please write a short reason.", QB_REFERENCE_REQUIRED: "Enter the transfer reference.", QB_INVALID_DECISION: "That choice is not allowed.", QB_NOT_SUBMITTED: "That set is not waiting for review.",
  QB_OWN_ITEM: "This is your own set.", QB_ALREADY_OWNED: "You already have this set.", QB_NOT_PURCHASED: "You need to buy this set first.", QB_FEATURE_DISABLED: "The Marketplace is not open yet.", QB_MINOR_CANNOT_PAY: "Please ask your teacher or a parent to buy this.",
  QB_INVALID_ATTEMPT: "That score is not valid.",
};
const message = (e: { message?: string }) => MESSAGES[/(QB_[A-Z_]+)/.exec(e.message ?? "")?.[1] ?? ""] ?? "That did not work. Please try again.";
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => { if (error) throw new Error(message(error)); return data as T; });

// Buyers
export const marketplaceOpen = () => rpc<boolean>("qb_mk_enabled").catch(() => false);
export const catalog = (f: { q?: string; subject?: string; grade?: string; school?: string; offset?: number } = {}) => rpc<Listing[]>("qb_mk_catalog", { p_q: f.q || null, p_subject: f.subject || null, p_grade: f.grade || null, p_school: f.school || null, p_limit: 48, p_offset: f.offset ?? 0 });
export const listing = (slug: string) => rpc<ListingDetail | null>("qb_mk_item_public", { p_slug: slug });
export const myPurchases = () => rpc<Purchase[]>("qb_mk_my_purchases");
export const openSet = (itemId: string) => rpc<OpenSet>("qb_mk_open", { p_item: itemId });
export const recordAttempt = (itemId: string, correct: number, total: number) => rpc<void>("qb_mk_record_attempt", { p_item: itemId, p_correct: correct, p_total: total });

// Starts the payment: the server prices the cart from the database, sends it to Paystack, and gives back the payment page address.
export async function buy(itemId: string): Promise<{ url: string }> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in to buy.");
  const res = await fetch("/api/marketplace/checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ itemId }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.url) throw Object.assign(new Error(typeof body?.error === "string" ? body.error : "We could not start the payment. Please try again."), { code: typeof body?.code === "string" ? body.code : "" });
  return { url: String(body.url) };
}

// Sellers
export const sellerGet = () => rpc<Seller | null>("qb_mk_seller_get");
export const sellerSave = (i: SellerInput) => rpc<Seller>("qb_mk_seller_save", { p_display_name: i.display_name, p_school: i.school, p_phone: i.phone, p_method: i.method, p_network: i.network, p_account: i.account, p_account_name: i.account_name, p_accept_terms: i.accept_terms });
export const myItems = () => rpc<MyItem[]>("qb_mk_my_items");
export const myItem = (id: string) => rpc<ItemDetail>("qb_mk_my_item", { p_item: id });
export const itemSave = (i: ItemInput) => rpc<{ id: string; slug: string }>("qb_mk_item_save", { p_id: i.id, p_title: i.title, p_description: i.description, p_subject: i.subject, p_grade: i.grade, p_term: i.term, p_school: i.school, p_price_minor: i.price_minor });
export const itemQuestionsSet = (id: string, questions: QuestionInput[]) => rpc<{ ok: boolean; count: number }>("qb_mk_item_questions_set", { p_item: id, p_questions: questions });
export const itemSubmit = (id: string) => rpc<{ ok: boolean; duplicates: number }>("qb_mk_item_submit", { p_item: id });
export const itemUnlist = (id: string) => rpc<void>("qb_mk_item_unlist", { p_item: id });
export const mySales = (limit = 50) => rpc<Sale[]>("qb_mk_my_sales", { p_limit: limit });
export const sellerSummary = () => rpc<SellerSummary>("qb_mk_seller_summary");
export const payoutQuote = () => rpc<PayoutQuote>("qb_mk_payout_quote");
export const payoutRequest = (expected: number) => rpc<{ ok: boolean; payout: string; amount_minor: number; due_at: string }>("qb_mk_payout_request", { p_expected: expected });
export const payoutCancel = (id: string) => rpc<void>("qb_mk_payout_cancel", { p_payout: id });
export const myPayouts = () => rpc<Payout[]>("qb_mk_my_payouts");

// Staff
export const adminItems = (status = "submitted") => rpc<AdminItem[]>("qb_mk_admin_items", { p_status: status });
export const adminItem = (id: string) => rpc<AdminItemDetail>("qb_mk_admin_item", { p_id: id });
export const adminReview = (id: string, decision: "approve" | "reject", note: string) => rpc<{ ok: boolean }>("qb_mk_admin_review", { p_item: id, p_decision: decision, p_note: note });
export const adminSellers = (status = "") => rpc<AdminSeller[]>("qb_mk_admin_sellers", { p_status: status });
export const adminSellerSet = (id: string, status: "pending" | "verified" | "suspended", note: string) => rpc<{ ok: boolean }>("qb_mk_admin_seller_set", { p_seller: id, p_status: status, p_note: note });
export const adminPayouts = (status = "requested") => rpc<AdminPayout[]>("qb_mk_admin_payouts", { p_status: status });
export const adminPayoutSet = (id: string, action: "paid" | "reject", ref: string, note: string) => rpc<{ ok: boolean }>("qb_mk_admin_payout_set", { p_payout: id, p_action: action, p_ref: ref || null, p_note: note });
export const adminSummary = () => rpc<AdminSummary>("qb_mk_admin_summary");
export const adminReverse = (reference: string, reason: string) => rpc<{ outcome: string }>("qb_mk_admin_reverse", { p_reference: reference, p_reason: reason });
export async function marketplaceSwitch(on: boolean) {
  const { error } = await getSupabaseBrowserClient().rpc("qb_setting_set", { p_key: "flags.marketplace", p_value: on });
  if (error) throw new Error("That did not work. Please try again.");
}

// Reads questions pasted from a spreadsheet or document. One question per block, blocks separated by a blank line:
//   Question text?
//   A. option      (or "A) option", "a. option", "1. option")
//   B. option
//   Answer: B      (the letter or number of the correct option; "Answer: B" or "Ans B")
//   Why: because…  (optional)
export function parseQuestions(text: string): { questions: QuestionInput[]; errors: string[] } {
  const questions: QuestionInput[] = [], errors: string[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  blocks.forEach((block, n) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const opt = /^\(?([A-Ea-e1-5])[.)\]:]\s*(.+)$/, ans = /^(?:answer|ans|correct)\s*[:=-]?\s*\(?([A-Ea-e1-5])\)?/i, why = /^(?:why|explanation|because)\s*[:=-]\s*(.+)$/i;
    const stem: string[] = [], options: string[] = []; let correct = -1, explanation = "";
    for (const l of lines) {
      const a = ans.exec(l), w = why.exec(l), o = opt.exec(l);
      if (a) correct = /[1-5]/.test(a[1]) ? Number(a[1]) - 1 : a[1].toUpperCase().charCodeAt(0) - 65;
      else if (w) explanation = w[1];
      else if (o && (options.length > 0 || stem.length > 0)) options.push(o[2].trim());
      else if (options.length === 0) stem.push(l.replace(/^\d+[.)]\s+/, ""));
      else options[options.length - 1] += ` ${l}`;
    }
    const text1 = stem.join(" ").trim();
    if (text1.length < 8) errors.push(`Question ${n + 1}: the question text is too short.`);
    else if (options.length < 2 || options.length > 5) errors.push(`Question ${n + 1}: it needs 2 to 5 answers (found ${options.length}).`);
    else if (correct < 0 || correct >= options.length) errors.push(`Question ${n + 1}: add a line like "Answer: B" that points to one of the answers.`);
    else questions.push({ question_text: text1, options, correct_index: correct, ...(explanation ? { explanation } : {}) });
  });
  return { questions, errors };
}

// The same format back again, for editing a saved set.
export const questionsToText = (qs: QuestionInput[]) => qs.map((q) => [q.question_text, ...q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`), `Answer: ${String.fromCharCode(65 + q.correct_index)}`, ...(q.explanation ? [`Why: ${q.explanation}`] : [])].join(NL)).join(NL + NL);
const NL = String.fromCharCode(10);
