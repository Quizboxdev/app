// Plain words for the inter-school codes, dates and money. Used by every inter-school screen so a database code is never shown to a person.
import type { Problem, RegistrationState } from "./types";

export const MESSAGES: Record<string, string> = {
  QB_FEATURE_DISABLED: "Inter-school competitions are not switched on yet.",
  IS_SIGN_IN_REQUIRED: "Please sign in.", IS_NOT_AUTHORISED: "You are not allowed to do that.", IS_NOT_FOUND: "That could not be found.",
  IS_TITLE_REQUIRED: "Give the competition a title of at least three characters.", IS_ORGANISER_NOT_APPROVED: "Only administrators, staff of a verified school and verified sponsors can organise competitions.",
  IS_SPONSOR_MUST_FUND: "A sponsor's competition must be sponsored.", IS_ADMIN_ONLY_SETTING: "Only a QuizBox administrator can choose that.", IS_UNKNOWN_SETTING: "That setting is not recognised.",
  IS_RATE_LIMITED: "Too many requests. Please try again later.", IS_COMPETITION_CLOSED: "This competition has finished or was cancelled.",
  IS_FROZEN_AFTER_PUBLISH: "Rules, levels, rounds and scoring cannot change after publishing.", IS_CAPACITY_CANNOT_SHRINK: "Capacity cannot be reduced after publishing.",
  IS_DATE_CANNOT_MOVE_EARLIER: "After publishing, closing dates can only move later.", IS_FUNDING_REQUIRED_FOR_CAPACITY: "More places need a new quotation and payment first.",
  IS_DIVISIONS_INVALID: "Add between 1 and 30 class-level divisions.", IS_LEVEL_INVALID: "Choose class levels from Basic 1 to SHS 3.", IS_MIXED_LEVELS_NOT_CONFIRMED: "Tick “mix levels” to put different class levels in one division.",
  IS_LEVEL_IN_TWO_DIVISIONS: "A class level can only be in one division.", IS_ROUNDS_INVALID: "Add between 1 and 100 rounds.", IS_ROUND_DATES_INVALID: "Each round needs an opening time and a later closing time.",
  IS_ROUNDS_OVERLAP: "Rounds must follow one another without overlapping.", IS_SECTION_INVALID: "Each round needs at least one subject and a number of questions.", IS_SECTION_DUPLICATE_SUBJECT: "A subject appears twice in one round.",
  IS_SUBJECT_NOT_FOR_LEVEL: "That subject does not belong to this class level.", IS_DIFFICULTY_MIX_INVALID: "The easy, medium and hard numbers must add up to the number of questions.",
  IS_NOT_ENOUGH_QUESTIONS: "There are not enough approved questions for that choice.", IS_NOT_READY: "The competition is not ready to publish. See the checklist.",
  IS_INVALID_TRANSITION: "That cannot be done at this stage.", IS_REASON_REQUIRED: "Please give a reason.", IS_APPROVAL_REQUIRED: "A QuizBox administrator must approve this competition before it can be published.",
  IS_FUNDING_REQUIRED: "Sponsorship payment or funding approval is needed first.", IS_PUBLISH_FIRST: "Publish the competition first.",
  IS_SCHOOL_NOT_VERIFIED: "That school has not been verified by QuizBox yet.", IS_SCHOOL_NOT_INVITED: "Your school has not been invited to this competition.", IS_SCHOOL_PLACES_FULL: "No more schools can join.",
  IS_SCHOOL_DISQUALIFIED: "This school is disqualified.", IS_SCHOOLS_INVALID: "Choose between 1 and 200 schools.", IS_SCHOOL_REQUIRED: "Choose your school.", IS_SCHOOL_NOT_REGISTERED: "Both schools must be registered.",
  IS_DIVISION_NOT_FOUND: "That division was not found.", IS_NOT_A_LEARNER: "Only learner accounts can take part.", IS_MANAGED_LEARNER_NOT_ALLOWED: "Learners with a managed (under 13) account cannot take part yet.",
  IS_LEVEL_MISMATCH: "This learner's class level does not match the division.", IS_ALREADY_REGISTERED: "This learner is already registered for another division or school.", IS_DISQUALIFIED: "This learner is disqualified.",
  IS_NOT_THIS_SCHOOL: "This learner is not recorded at that school.", IS_COMPETITION_FULL: "All places in this competition are taken.", IS_DIVISION_FULL: "All places in this division are taken.",
  IS_SCHOOL_ALLOCATION_FULL: "Your school has used all its places.", IS_SCHOOL_LEVEL_FULL: "Your school has used all its places for this class level.",
  IS_REGISTRATION_NOT_OPEN: "Registration has not opened yet.", IS_REGISTRATION_PAUSED: "Registration is paused.", IS_REGISTRATION_CLOSED: "Registration has closed.", IS_COMPETITION_CANCELLED: "This competition was cancelled.",
  IS_ROSTER_LOCKED: "The roster is locked and can no longer change.", IS_TEACHER_REGISTRATION_ONLY: "Learners are entered by their school for this competition.", IS_LEARNER_REGISTRATION_ONLY: "Learners register themselves for this competition.",
  IS_LEARNERS_INVALID: "Choose between 1 and 200 learners.", IS_REPLACEMENT_NOT_ELIGIBLE: "The replacement learner is not eligible.",
  IS_NOT_REGISTERED: "You are not registered for this competition.", IS_ALREADY_TAKEN: "You have already taken this round.", IS_NO_PAPER: "This round has no question paper yet.",
  IS_ROUND_NOT_OPEN: "This round is not open yet.", IS_ROUND_CLOSED: "This round has closed.", IS_ROUND_PAUSED: "The competition is paused.", IS_ROUND_CANCELLED: "The competition was cancelled.",
  IS_ROUND_WAITING: "Results of the round before are not out yet.", IS_ROUND_NOT_THROUGH: "You did not qualify for this round.", IS_ROUND_NOT_CONFIRMED: "Your place is not confirmed yet.",
  IS_ROUND_BYE: "Your school has a bye in this round: no paper to take.", IS_ROUND_NO_FIXTURE: "Your school has no fixture in this round.", IS_ROUND_NOT_YOUR_ROUND: "That round is not in your division.",
  IS_ANSWERS_INVALID: "Those answers could not be read.", IS_ROUND_HAS_NO_FIXTURES: "This round has no fixtures: everyone sits it together.", IS_ROUND_FINALISED: "This round is already final.",
  IS_FIXTURE_OUTSIDE_ROUND: "A fixture must be inside its round's dates.", IS_FIXTURE_SCHOOLS_INVALID: "Choose two different schools.", IS_FIXTURE_CLASH: "One of these schools already has a fixture at that time.",
  IS_METHOD_INVALID: "Choose a fixture method.", IS_NO_ROUND_FOR_METHOD: "No unfinished round uses that format.", IS_NOT_ENOUGH_SCHOOLS: "At least two schools with enough confirmed learners are needed.",
  IS_ROUND_ALREADY_STARTED: "Learners have already started that round.", IS_PREVIOUS_ROUND_NOT_FINALISED: "Finalise the round before first.", IS_TOO_MANY_GROUPS: "There are too many groups for the number of schools.",
  IS_NOT_ENOUGH_ROUNDS: "Add more rounds of this format: each school meets every other once.", IS_ROUND_STILL_OPEN: "The round is still open.", IS_LEARNERS_STILL_WRITING: "Some learners are still answering.",
  IS_NO_FIXTURES: "Create the fixtures first.", IS_ROUND_NOT_FINALISED: "This round is not final yet.", IS_DISPUTE_WINDOW_CLOSED: "Disputes can be raised for seven days after results.", IS_DISPUTE_ALREADY_OPEN: "A dispute is already open for this result.",
  IS_SCORE_INVALID: "The score must be between 0 and the number of questions.",
  IS_NOT_SPONSORED: "This competition is not a sponsored one.", IS_RATE_NOT_SET: "The price per participant has not been set yet.", IS_NOTHING_TO_QUOTE: "All expected places are already funded.",
  IS_QUOTE_BELOW_EXPECTED: "A quotation must cover the expected number of participants.", IS_DISCOUNT_TOO_LARGE: "The discount is larger than the fee.", IS_SPONSOR_NOT_APPROVED: "That sponsor is not verified.",
  IS_SPONSOR_NAME_REQUIRED: "Enter the sponsor's name.", IS_QUOTE_EXPIRED: "This quotation has expired. Ask for a new one.", IS_ACTION_INVALID: "Choose what to do with the invoice.",
  IS_INVOICE_ALREADY_SETTLED: "This invoice has already been settled.", QB_BELOW_MINIMUM_CHARGE: "The smallest online payment is GHS 5.", IS_RATE_INVALID: "Enter a price between GHS 0 and GHS 10,000.",
  IS_RESULTS_NOT_FINAL: "Certificates are issued after every round is final.", IS_DISPUTES_OPEN: "Decide the open disputes before issuing certificates.", IS_ONLY_OPEN_PUBLISHED_CAN_BE_LISTED: "Only a published, open competition can be listed.",
  IS_TEAM_SIZE_REQUIRED: "Team totals need equal team sizes: set the most learners per class level per school.",
  IS_NO_DIVISIONS: "Add at least one class-level division.", IS_NO_ROUNDS: "Every division needs at least one round.", IS_DATES_REQUIRED: "Set the registration and competition dates.",
  IS_REGISTRATION_ALREADY_CLOSED: "The registration closing date has passed.", IS_REGISTRATION_CLOSES_AFTER_END: "Registration must close before the competition ends.", IS_CAPACITY_ABOVE_EXPECTED: "Capacity cannot be higher than the expected number of participants.",
  IS_ROUND_OUTSIDE_COMPETITION: "A round falls outside the competition dates.",
};
export function codeOf(message: string): string { return /\b((?:IS|QB)_[A-Z_]+)\b/.exec(message)?.[1] ?? ""; }
export function plain(message: string): string { const code = codeOf(message); return MESSAGES[code] ?? "That did not work. Please try again."; }
export function problemText(p: Problem): string {
  if (typeof p === "string") return MESSAGES[p] ?? p;
  const where = [p.division, p.round ? `round ${p.round}` : ""].filter(Boolean).join(", ");
  const short = p.sections?.filter((s) => !s.ok).map((s) => `${s.subject}: ${s.have} available, ${s.need} needed${s.short.length ? ` (${s.short.map((x) => `${x.difficulty} ${x.have}/${x.need}`).join(", ")})` : ""}`).join("; ");
  return `${where ? `${where}: ` : ""}${MESSAGES[p.code] ?? p.code}${short ? ` ${short}` : ""}`;
}
export const ghs = (minor: number) => `GHS ${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const sponsorshipFee = (participants: number, rateMinor: number, setupMinor = 0, discountMinor = 0) => participants * rateMinor + setupMinor - discountMinor;
// All competition times are shown in Ghana time (GMT), whatever the device is set to.
export const when = (iso: string | null | undefined) => (iso ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" })} GMT` : "To be announced");
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" }) : "To be announced");
export const minutes = (seconds: number) => `${Math.round(seconds / 60)} minute${Math.round(seconds / 60) === 1 ? "" : "s"}`;
export const levelName = (code: string) => (code.startsWith("SHS") ? `SHS ${code.slice(3)}` : `Basic ${code.slice(1)}`);
export const REGISTRATION: Record<RegistrationState, string> = { OPEN: "Registration open", WAITLIST: "Full: waiting list open", FULL: "Full", NOT_YET: "Registration not open yet", CLOSED: "Registration closed", PAUSED: "Registration paused", CANCELLED: "Cancelled", AWAITING_FUNDING: "Awaiting sponsorship" };
export const canRegister = (s: RegistrationState) => s === "OPEN" || s === "WAITLIST";
export const RULE: Record<string, string> = { ALL: "Everyone goes through", PASS: "Pass mark", TOP_LEARNERS: "Top learners", TOP_SCHOOLS: "Top schools", FIXTURE_WINNERS: "Fixture winners", PASS_AND_TOP_LEARNERS: "Pass mark and top learners", MANUAL: "Chosen by the organiser" };
export function ruleText(rule: string, pass?: number | null, top?: number | null): string {
  if (rule === "PASS") return `Score ${pass}% or more to go through`;
  if (rule === "TOP_LEARNERS") return `Top ${top} learners go through`;
  if (rule === "TOP_SCHOOLS") return `Top ${top} schools go through${pass ? ` (learners need ${pass}%)` : ""}`;
  if (rule === "PASS_AND_TOP_LEARNERS") return `Top ${top} learners with ${pass}% or more go through`;
  return RULE[rule] ?? rule;
}
export const SCORING: Record<string, string> = { TOP_N: "Sum of each school's best learners (percent)", AVERAGE: "Average of all entered learners (absent counts as zero)", TEAM_TOTAL: "Total of all team members' scores (absent counts as zero)", FIXTURE_POINTS: "Fixture points: 3 for a win, 1 for a draw" };
export const TIE_BREAK = "Level scores are separated by the shorter total answering time; a knockout fixture still level after that is decided by lot, and the lot is recorded.";
export const CERTIFICATE: Record<string, string> = { PARTICIPATION: "Certificate of participation", FINALIST: "Finalist certificate", WINNER: "Winner's certificate", CHAMPION_SCHOOL: "Champion school" };
export const humanStatus = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
// A campaign link carries where it was shared from, so registrations can be counted by source. Never any personal data.
export const SOURCES = ["LINK", "QR", "WHATSAPP", "SOCIAL", "SPONSOR", "INVITE"] as const;
export const sourceParam = (value: string | string[] | undefined | null): string => { const v = String(Array.isArray(value) ? value[0] : value ?? "").toUpperCase(); return (SOURCES as readonly string[]).includes(v) ? v : "DIRECT"; };
export const campaignLink = (origin: string, slug: string, source: (typeof SOURCES)[number] = "LINK") => `${origin.replace(/\/$/, "")}/inter-school/${slug}?src=${source.toLowerCase()}`;
export function whatsappMessage(title: string, link: string, closes: string | null, sponsor?: string | null): string {
  return [`*${title}*`, sponsor ? `Sponsored by ${sponsor}.` : "", "An inter-school quiz competition on QuizBox.", closes ? `Register by ${day(closes)}.` : "", link].filter(Boolean).join("\n");
}
export const whatsappHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
