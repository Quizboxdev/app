import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { mockMessage } from "@/lib/mock-exams/messages";
import type { RoundState, Totals } from "@/lib/mock-exams/tally";

// Mock exams (migrations 20261122100000, 20261122110000, 20261122120000). The database decides who may build, assign, sell, take and read an exam and enforces every count;
// this file only asks and shows. Closed until flags.mock_exams is on.
export type Exam = { id: string; title: string; description: string; purpose: string; audience: string; curriculum_id: string; target_grade: string; desired_total: number; time_limit_minutes: number; attempts_allowed: number;
  shuffle_questions: boolean; instructions: string; status: "draft" | "published" | "archived"; dirty: boolean; owner_kind: "teacher" | "sponsor" | "staff"; version_count: number; current_version_id: string | null; current_version_no: number | null;
  created_at: string; updated_at: string; rounds: RoundState[]; totals: Totals; versions?: Array<{ id: string; version_no: number; published_at: string; question_count: number; total_marks: number }> };
export type ExamRow = { id: string; title: string; purpose: string; target_grade: string; status: Exam["status"]; dirty: boolean; desired_total: number; selected: number; version_count: number; updated_at: string };
export type AuthorStatus = { enabled: boolean; can_author: boolean; kind: "teacher" | "sponsor" | "staff" | null; reason: string | null };
export type CurriculumOption = { id: string; code: string; name: string; version: string };
export type SubjectOption = { subject_code: string; label: string; topics: number };
export type TopicOption = { topic_id: string; title: string; strand: string; sub_strand: string; indicator_code: string; available: number; available_to_add: number; easy: number; medium: number; hard: number; in_exam: boolean };
export type Candidate = { id: string; question_text: string; answer_type: string; marks: number; level: string; in_round: boolean; blocked: boolean };
export type ReviewQuestion = { position: number; round: number; question_id: string; question_text: string; answer_type: string; marks: number; grade_code: string; subject_code: string; topic_title: string; picked_by: "auto" | "manual"; available: boolean };
export type Review = { exam: Exam; readiness: { ready: boolean; issues: Array<{ code: string; count?: number; round?: number }>; totals: Totals }; questions: ReviewQuestion[];
  scoring: { total_marks: number; answer_types: Record<string, number>; time_limit_minutes: number; attempts_allowed: number; shuffle_questions: boolean } };
export type ClassOption = { id: string; class_name: string; grade_label: string; grade_code: string; stage: string; learners: number };
export type ExamAssignment = { assignment_id: string; class_id: string; class_name: string; version_no: number; due_at: string | null; status: string; learners: number; created_at: string };
export type Participant = { attempt_id: string | null; source: "class" | "market" | "family" | "link"; group: string; class_id: string | null; participant_key: string; participant: string; attempt_no: number; state: "not_started" | "in_progress" | "submitted" | "expired";
  started_at: string | null; submitted_at: string | null; score: number | null; total_marks: number | null; percent: number | null };
export type Results = { exam: { id: string; title: string; status: string; purpose?: string; target_grade?: string }; version: { id: string; version_no: number; question_count: number; total_marks: number; published_at: string } | null;
  versions: Array<{ id: string; version_no: number }>; summary: { assigned: number; started: number; finished: number; in_progress: number; not_started: number; completion_percent: number | null; average_percent: number | null; median_percent: number | null;
    highest_percent: number | null; lowest_percent: number | null; scored: number } | null;
  questions: Array<{ position: number; question_id: string; external_id: string | null; question_text: string; subject_code: string; grade_code: string; answer_type: string; marks: number; answered: number; correct: number; correct_percent: number | null }>;
  participants: Participant[] };
export type ResultRow = { attempt_id: string; group: string; participant: string; participant_key: string; attempt_no: number; state: string; started_at: string | null; submitted_at: string | null; attempt_score: number | null; attempt_total: number | null;
  attempt_percent: number | null; position: number; presented_order: number | null; question_id: string; external_id: string | null; question_text: string; subject_code: string; grade_code: string; answer_type: string; answer: string | null;
  correct_answer: string | null; is_correct: boolean | null; marks_awarded: number; marks: number; answered: boolean };
export type ResultFilter = { versionId?: string | null; classId?: string | null; studentId?: string | null; questionId?: string | null; state?: string | null };
export type Listing = { item_id: string; slug: string; status: "draft" | "submitted" | "approved" | "rejected" | "unlisted"; title: string; description: string; subject: string; grade: string; term: string | null; school: string; price_minor: number;
  seller_share_minor: number; platform_fee_minor: number; seller_share_percent: number; access_days: number; min_price_minor: number; max_price_minor: number; min_questions: number; question_count: number; review_note: string; mock_exam_id: string;
  version_no: number; behind_current: boolean; sales?: number };
export type ListingInfo = { mock_exam: true; version_no: number; purpose: string; target_grade: string; question_count: number; total_marks: number; time_limit_minutes: number; attempts_allowed: number; access_days: number;
  rounds: Array<{ grade_code: string; subject_label: string; topic_title: string; questions: number }> };
export type MockPurchase = { purchase_id: string; item_id: string; slug: string; title: string; expires_at: string; active: boolean; days_left: number; status: string; version_no: number; question_count: number; time_limit_minutes: number;
  attempts_allowed: number; attempts_used: number; in_progress_attempt: string | null; last_attempt: { id: string; state: string; percent: number | null } | null };

export { mockMessage };
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => { if (error) throw new Error(mockMessage(error.message)); return data as T; });

export const mockEnabled = () => rpc<boolean>("qb_mock_enabled").catch(() => false);
export const authorStatus = () => rpc<AuthorStatus>("qb_mock_author_status");
export const curricula = () => rpc<CurriculumOption[]>("qb_mock_curricula");
export const eligibleGradesFor = (target: string) => rpc<string[]>("qb_mock_grades", { p_target: target });
export const subjects = (curriculum: string, grade: string) => rpc<SubjectOption[]>("qb_mock_subjects", { p_curriculum: curriculum, p_grade: grade });
export const topics = (curriculum: string, grade: string, subject: string, exam: string | null) => rpc<TopicOption[]>("qb_mock_topics", { p_curriculum: curriculum, p_grade: grade, p_subject: subject, p_exam: exam });

export type ExamInput = { title: string; description: string; purpose: string; audience: string; curriculum_id: string; target_grade: string; desired_total: number; time_limit_minutes: number; attempts_allowed: number; shuffle_questions: boolean; instructions: string };
export const listExams = () => rpc<ExamRow[]>("qb_mock_exam_list");
export const getExam = (id: string) => rpc<Exam>("qb_mock_exam_get", { p_exam: id });
export const createExam = (p: ExamInput) => rpc<Exam>("qb_mock_exam_create", { p });
export const updateExam = (id: string, p: Partial<ExamInput>) => rpc<Exam>("qb_mock_exam_update", { p_exam: id, p });
export const deleteExam = (id: string) => rpc<void>("qb_mock_exam_delete", { p_exam: id });
export const archiveExam = (id: string) => rpc<Exam>("qb_mock_exam_archive", { p_exam: id });
export const saveRound = (exam: string, round: string | null, grade: string, subject: string, topic: string, requested: number) => rpc<Exam>("qb_mock_round_save", { p_exam: exam, p_round: round, p_grade: grade, p_subject: subject, p_topic: topic, p_requested: requested });
export const deleteRound = (exam: string, round: string) => rpc<Exam>("qb_mock_round_delete", { p_exam: exam, p_round: round });
export const pickRound = (exam: string, round: string) => rpc<{ added: number; exam: Exam }>("qb_mock_round_pick", { p_exam: exam, p_round: round });
export const clearRound = (exam: string, round: string) => rpc<Exam>("qb_mock_round_clear", { p_exam: exam, p_round: round });
export const candidates = (exam: string, round: string, offset = 0) => rpc<Candidate[]>("qb_mock_round_candidates", { p_exam: exam, p_round: round, p_limit: 60, p_offset: offset });
export const setRoundQuestions = (exam: string, round: string, ids: string[]) => rpc<Exam>("qb_mock_round_set_questions", { p_exam: exam, p_round: round, p_question_ids: ids });
export const reviewExam = (id: string) => rpc<Review>("qb_mock_exam_review", { p_exam: id });
export const publishExam = (id: string) => rpc<{ version_id: string; version_no: number; question_count: number; exam: Exam }>("qb_mock_exam_publish", { p_exam: id });
export const examHealth = (id: string) => rpc<{ version_no: number | null; stale_questions: number }>("qb_mock_exam_health", { p_exam: id });

export const classOptions = () => rpc<ClassOption[]>("qb_mock_class_options");
export const assignToClass = (exam: string, cls: string, startAt: string | null, dueAt: string | null) => rpc<{ assignment_id: string; assessment_id: string; version_no: number }>("qb_mock_assign_class", { p_exam: exam, p_class: cls, p_start: startAt ?? new Date().toISOString(), p_due: dueAt });
export const examAssignments = (exam: string) => rpc<ExamAssignment[]>("qb_mock_exam_assignments", { p_exam: exam });
export const results = (exam: string, version: string | null) => rpc<Results>("qb_mock_results", { p_exam: exam, p_version: version });
export const resultRows = (exam: string, f: ResultFilter = {}, limit = 200, offset = 0) => rpc<{ total: number; rows: ResultRow[] }>("qb_mock_result_rows",
  { p_exam: exam, p_version: f.versionId ?? null, p_class: f.classId ?? null, p_student: f.studentId ?? null, p_question: f.questionId ?? null, p_state: f.state ?? null, p_limit: limit, p_offset: offset });

export const prepareListing = (exam: string, priceMinor: number, description: string, term: string) => rpc<Listing>("qb_mock_listing_prepare", { p_exam: exam, p_price_minor: priceMinor, p_description: description || null, p_term: term || null });
export const getListing = (exam: string) => rpc<Listing | null>("qb_mock_listing_get", { p_exam: exam });
export const submitListing = (exam: string) => rpc<Listing>("qb_mock_listing_submit", { p_exam: exam });
export const unlistListing = (exam: string) => rpc<Listing>("qb_mock_listing_unlist", { p_exam: exam });
export const listingInfo = (slug: string) => rpc<ListingInfo | null>("qb_mock_listing_info", { p_slug: slug }).catch(() => null);
export const listingKinds = (slugs: string[]) => (slugs.length ? rpc<string[]>("qb_mock_listing_kinds", { p_slugs: slugs }).catch(() => [] as string[]) : Promise.resolve([] as string[]));
export type AdminMockListing = { version_no: number; purpose: string; target_grade: string; question_count: number; total_marks: number; time_limit_minutes: number; attempts_allowed: number; stale_questions: number;
  rounds: Array<{ grade_code: string; subject_label: string; topic_title: string; selected: number }>; questions: Array<{ position: number; grade_code: string; subject_code: string; answer_type: string; question_text: string; correct_answer: string }> };
export const adminMockListing = (item: string) => rpc<AdminMockListing | null>("qb_mock_admin_listing", { p_item: item });
export const myMockPurchases = () => rpc<MockPurchase[]>("qb_mock_my_purchases");
export const startPurchased = (purchase: string) => rpc<{ assessment_id: string; enrolment_id: string; version_no: number; expires_at: string }>("qb_mock_start_purchased", { p_purchase: purchase });

export type ExportQuery = ResultFilter & { examId: string; format: "csv" | "xlsx" | "json" };
async function post(q: ExportQuery): Promise<Response> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in.");
  return fetch("/api/teacher/mock-exams/export", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(q) });
}
const failure = async (res: Response) => { const b = await res.json().catch(() => ({})); return new Error(typeof b?.error === "string" ? b.error : "We could not prepare that export. Please try again."); };
// Downloads the file through the browser. Returns how many rows it holds and how many matched (they differ when the row limit cut it short).
export async function downloadResults(q: Omit<ExportQuery, "format">, format: "csv" | "xlsx"): Promise<{ rows: number; total: number }> {
  const res = await post({ ...q, format });
  if (!res.ok) throw await failure(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `quizbox-mock-exam-results.${format}`;
  const blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { rows: Number(res.headers.get("x-export-rows") ?? 0), total: Number(res.headers.get("x-export-total") ?? 0) };
}

// Giving an exam to the family, and sharing it by link with paid places (migration 20261124130000). The database checks every call; this only asks and shows.
export type FamilyGift = { grant_id: string; student_id: string; name: string; version_no: number; expires_at: string; active: boolean; status: string; attempts_used: number; last_percent: number | null };
export type ShareLink = { id: string; code: string; path: string; version_no: number; seats_paid: number; coins_paid: number; joined: number; attempts: number; closes_at: string; status: "open" | "closed" | "ended"; behind_current: boolean; created_at: string };
export type LinkList = { enabled: boolean; eligible: boolean; coins_per_seat: number; max_seats: number; access_days: number; links: ShareLink[] };
export type LinkInfo = { title: string; description: string; purpose: string; from: string; target_grade: string; question_count: number; total_marks: number; time_limit_minutes: number; attempts_allowed: number; access_days: number;
  open: boolean; full: boolean; closes_at: string; mine: boolean; joined: boolean } | null;
export type MockGrant = { grant_id: string; source: "family" | "link"; title: string; from: string; expires_at: string; active: boolean; days_left: number; status: string; version_no: number; question_count: number; time_limit_minutes: number;
  attempts_allowed: number; attempts_used: number; in_progress_attempt: string | null; last_attempt: { id: string; state: string; percent: number | null } | null };
export const familyGive = (exam: string, students: string[]) => rpc<{ given: number; already: number; version_no: number; days: number }>("qb_mock_family_give", { p_exam: exam, p_students: students });
export const familyRevoke = (exam: string, student: string) => rpc<{ revoked: number }>("qb_mock_family_revoke", { p_exam: exam, p_student: student });
export const familyGiven = (exam: string) => rpc<FamilyGift[]>("qb_mock_family_given", { p_exam: exam });
export const shareLinks = (exam: string) => rpc<LinkList>("qb_mock_links", { p_exam: exam });
export const createLink = (exam: string, seats: number, closesAt: string | null) => rpc<ShareLink>("qb_mock_link_create", { p_exam: exam, p_seats: seats, p_closes_at: closesAt });
export const addLinkSeats = (link: string, total: number) => rpc<ShareLink>("qb_mock_link_add_seats", { p_link: link, p_total: total });
export const closeLink = (link: string) => rpc<ShareLink>("qb_mock_link_close", { p_link: link });
export const linkInfo = (code: string) => rpc<LinkInfo>("qb_mock_link_info", { p_code: code });
export const joinLink = (code: string) => rpc<{ ok: boolean; already: boolean; grant_id: string; expires_at: string }>("qb_mock_link_join", { p_code: code });
export const myMockGrants = () => rpc<MockGrant[]>("qb_mock_my_grants");
export const startGranted = (grant: string) => rpc<{ assessment_id: string; enrolment_id: string; version_no: number; expires_at: string }>("qb_mock_start_granted", { p_grant: grant });
