// Shapes returned by the public.interschool_* database functions (migrations 20261126100000 to 20261126140000).
export type CompetitionStatus = "DRAFT" | "PENDING_APPROVAL" | "PUBLISHED" | "PAUSED" | "CLOSED" | "COMPLETED" | "CANCELLED";
export type RegistrationState = "OPEN" | "WAITLIST" | "FULL" | "NOT_YET" | "CLOSED" | "PAUSED" | "CANCELLED" | "AWAITING_FUNDING";
export type Section = { subject_id: string; count: number; node_ids?: string[]; difficulty?: { easy?: number; medium?: number; hard?: number } };
export type RoundConfig = {
  id?: string; round_no?: number; title: string; format: "FIELD" | "ROUND_ROBIN" | "GROUP" | "KNOCKOUT"; stage: string; opens_at: string; closes_at: string; duration_seconds: number; sections: Section[];
  rule: "ALL" | "PASS" | "TOP_LEARNERS" | "TOP_SCHOOLS" | "FIXTURE_WINNERS" | "PASS_AND_TOP_LEARNERS" | "MANUAL"; pass_percent?: number | null; top_n?: number | null; frozen?: boolean;
};
export type Division = { id: string; title: string; level_codes: string[]; mixed: boolean; position: number; capacity: number | null; rounds: RoundConfig[] };
export type Settings = {
  title: string; description: string; sponsor_name: string | null; sponsor_logo_url: string | null; flyer_url: string | null; scale: "SCHOOLS" | "DISTRICT" | "REGIONAL" | "NATIONAL"; region: string | null; district: string | null;
  participation: "OPEN" | "INVITE"; entry_mode: "INDIVIDUAL" | "SCHOOL_TEAM"; registration_mode: "LEARNER" | "TEACHER" | "BOTH"; funding: "FREE" | "SPONSORED" | "COMPLIMENTARY";
  max_schools: number | null; max_per_school: number | null; max_per_level_per_school: number | null; expected_participants: number; capacity: number; waitlist: boolean;
  registration_opens_at: string | null; registration_closes_at: string | null; opens_at: string | null; ends_at: string | null; rules: string; prizes: string;
  school_scoring: "AVERAGE" | "TOP_N" | "TEAM_TOTAL" | "FIXTURE_POINTS"; scoring_top_n: number; min_candidates: number; score_carry: "RESET" | "ACCUMULATE";
};
export type Managed = Settings & {
  id: string; slug: string; status: CompetitionStatus; organiser_kind: "ADMIN" | "SCHOOL" | "SPONSOR"; is_admin: boolean; needs_approval: boolean; approved_at: string | null; decision_note: string | null;
  listed_at: string | null; funded_participants: number; funding_cleared_at: string | null; divisions: Division[];
};
export type ManageList = {
  can_create: { admin: boolean; sponsor: boolean; schools: Array<{ id: string; name: string }> };
  competitions: Array<{ id: string; slug: string; title: string; status: CompetitionStatus; participation: string; scale: string; funding: string; capacity: number; organiser_kind: string; approved: boolean; decision_note: string | null; registration_closes_at: string | null; opens_at: string | null; ends_at: string | null }>;
};
export type Problem = string | { code: string; division?: string; round?: number; sections?: SectionReport[] };
export type SectionReport = { subject_id: string; subject: string; need: number; have: number; ok: boolean; short: Array<{ difficulty: string; need: number; have: number }> };
export type Check = { problems: Problem[]; questions: Array<{ division: string; round: number; sections: SectionReport[] }>; needs_approval: boolean; approved: boolean };
export type Registrations = {
  registration: RegistrationState; capacity: number; expected: number; held: number; waiting: number;
  schools: Array<{ institution_id: string; school: string; region: string | null; status: string; source: string; locked: boolean; confirmed: number; pending: number; waiting: number }>;
  divisions: Array<{ id: string; title: string; capacity: number | null; confirmed: number; pending: number }>; sources: Record<string, number>; views: Record<string, number>;
};
export type Fixture = { id: string; home: string; away: string | null; scheduled_at: string; closes_at: string; status: string; group_no: number | null; winner: string | null; home_score: number | null; away_score: number | null; note: string | null };
export type Operations = {
  rounds: Array<{ round_id: string; division_id: string; division: string; round_no: number; title: string; format: RoundConfig["format"]; rule: RoundConfig["rule"]; opens_at: string; closes_at: string; finalised_at: string | null; started: number; submitted: number; fixtures: Fixture[] }>;
  disputes: Array<{ id: string; round_id: string; candidate_id: string | null; school: string | null; reason: string; status: "OPEN" | "UPHELD" | "REJECTED"; resolution: string | null; created_at: string }>;
};
export type Results = {
  finalised: boolean; competition?: string; division?: string; round?: string; rule?: string;
  schools?: Array<{ institution_id: string; school: string; rank: number | null; score: number; total_score: number; present: number; entered: number; eligible: boolean; qualified: boolean }>;
  learners?: Array<{ candidate_id: string; name: string; school: string | null; score: number; max_score: number; percent: number; total_score: number; rank: number | null; qualified: boolean; absent: boolean; seconds: number }>;
  fixtures?: Array<{ home: string; away: string | null; home_score: number | null; away_score: number | null; winner: string | null; note: string | null; status: string }>;
};
export type SchoolHome = Array<{ institution_id: string; school: string; competitions: Array<{ id: string; slug: string; title: string; status: CompetitionStatus; participation: string; registration_closes_at: string | null; opens_at: string | null; entry_status: string | null; registration: RegistrationState; places_used: number; max_per_school: number | null }> }>;
export type Roster = {
  competition: { id: string; slug: string; title: string; status: CompetitionStatus; rules: string; registration: RegistrationState; registration_closes_at: string | null; registration_mode: string; max_per_school: number | null; max_per_level_per_school: number | null };
  school: string; entry_status: string | null; locked: boolean;
  divisions: Array<{ id: string; title: string; level_codes: string[]; candidates: Array<{ id: string; user_id: string; name: string; status: string; verified: boolean }> }>;
};
export type Mine = Array<{
  candidate_id: string; status: string; status_reason: string | null; competition: { id: string; slug: string; title: string; status: CompetitionStatus }; division: string; school: string | null; can_withdraw: boolean;
  rounds: Array<{ round_id: string; round_no: number; title: string; question_count: number; duration_seconds: number; opens_at: string; closes_at: string; state: string; opponent: string | null; result: { score: number; max_score: number; percent: number; rank: number | null; qualified: boolean; absent: boolean } | null }>;
}>;
export type Sitting = { sitting_id: string; expires_at: string; server_time: string; submitted: boolean; resumed: boolean; title: string; questions: Array<{ id: string; question_text: string; options: string[]; chosen: number | null }> };
export type JoinOptions = {
  id: string; slug: string; title: string; rules: string; registration: RegistrationState; registration_mode: "LEARNER" | "TEACHER" | "BOTH"; learner: boolean; managed: boolean; level: string | null; individual_allowed: boolean;
  divisions: Array<{ id: string; title: string }>; schools: Array<{ id: string; name: string; verified_member: boolean; can_enter: boolean }>; mine: { status: string; division: string } | null;
};
export type Quote = { id: string; version: number; sponsor_name: string; participants: number; rate_minor: number; setup_fee_minor: number; discount_minor: number; discount_reason: string | null; total_minor: number; currency: string; status: string; valid_until: string };
export type Invoice = { id: string; number: string; sponsor_name: string; participants: number; amount_minor: number; currency: string; status: string; due_at: string | null; paid_at: string | null; funding_note: string | null; needs_refund?: boolean };
export type Figures = {
  schools_registered: number; schools_invited: number; expected_participants: number; funded_participants: number; registered_participants: number; took_part: number;
  regions: Array<{ region: string; schools: number; learners: number | null }>; rounds: Array<{ division: string; round: string; eligible: number; completed: number; completion_percent: number | null; average_percent: number | null }>;
  sources: Record<string, number>; page_views: number; shares: number;
};
export type Billing = { funding: string; funded_participants: number; capacity: number; funding_cleared: boolean; rate_minor: number | null; setup_fee_minor: number | null; billing_on: boolean; quotations: Quote[]; invoices: Invoice[]; figures: Figures };
export type SponsorHome = Array<{ id: string; slug: string; title: string; status: CompetitionStatus; funding: string; organiser: boolean; capacity: number; funding_cleared: boolean; registration: RegistrationState; quotations: Quote[]; invoices: Invoice[]; figures: Figures }>;
export type AdminOverview = {
  by_status: Record<string, number>; waiting_approval: Array<{ id: string; title: string; organiser: string; kind: string; participation: string; funding: string; capacity: number }>;
  unpaid_invoices: Array<{ id: string; number: string; competition_id: string; competition: string; sponsor: string; amount_minor: number; status: string; due_at: string | null }>; refunds_to_review: number;
  open_disputes: Array<{ id: string; competition_id: string; competition: string; reason: string }>; rounds_to_finalise: Array<{ round_id: string; competition_id: string; competition: string; division: string; round: string; closed_at: string }>;
  settings: { rate_minor: number | null; setup_fee_minor: number | null; allow_managed_learners: boolean };
};
export type Certificate = { code: string; kind: string; recipient: string; school: string | null; competition: string; division: string; issued_at: string; mine: boolean };
export type PublicCompetition = {
  id: string; slug: string; title: string; description: string; status: CompetitionStatus; participation: "OPEN" | "INVITE"; entry_mode: string; registration_mode: string; scale: string; region: string | null; district: string | null;
  sponsor_name: string | null; sponsor_logo_url: string | null; flyer_url: string | null; host: string | null; rules: string; prizes: string; funding: string; registration: RegistrationState;
  registration_opens_at: string | null; registration_closes_at: string | null; opens_at: string | null; ends_at: string | null; schools_registered: number; max_schools: number | null; places_left: number; max_per_school: number | null; listed: boolean; school_scoring: string;
  divisions: Array<{ id: string; title: string; level_codes: string[]; subjects: string[]; rounds: Array<{ round_no: number; title: string; opens_at: string; closes_at: string; question_count: number; duration_seconds: number; rule: string; pass_percent: number | null; top_n: number | null }> }>;
};
export type PublicListing = { slug: string; title: string; summary: string; sponsor_name: string | null; sponsor_logo_url: string | null; registration_closes_at: string | null; opens_at: string | null; ends_at: string | null; registration: RegistrationState; divisions: string[] | null };
export type PublicResult = { division: string; round_no: number; round: string; schools: NonNullable<Results["schools"]>; leaders: Array<{ rank: number; name: string; school: string | null; percent: number }> };
