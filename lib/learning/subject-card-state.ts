import type { MyAccess } from "@/lib/api/access";

// What a Q-Insignia subject card says and offers. Every input comes from existing server data:
//   available   question count from qb_practice_menu (already filtered to the learner's grade, market and published content)
//   access      qb_my_access (the free allowance is account-wide, never per subject)
//   attempt     a stored IN_PROGRESS attempt for this subject (qb_my_attempts_page), resumed by id, never re-created
//   evidence    how many results / topics back a mastery figure (from the existing mastery engine's inputs)
//   weak        the server's weak-subject signal (qb_student_insights), never a guess made here
// Photo availability is NOT an input: a missing photo changes the artwork only (PHOTO_UNAVAILABLE), never the state.
export type SubjectCardState =
  | "LOADING" | "ERROR" | "CONTENT_UNAVAILABLE" | "UNFINISHED" | "ACCESS_REQUIRED"
  | "REVISION_RECOMMENDED" | "NEXT_TOPIC" | "READY" | "UNSTARTED";

export type SubjectCardInput = {
  loading?: boolean;
  error?: boolean;
  available?: number | null;
  access?: MyAccess | null;
  attempt?: { id: string; answered?: number | null; total?: number | null } | null;
  evidence?: number | null;
  weak?: boolean;
  nextTopic?: { id: string; title: string } | null; // only when real curriculum sequencing supplies it
};

export type SubjectCardView = {
  state: SubjectCardState;
  status: string | null;         // the one status line on the card (null = nothing to say)
  tone: "info" | "success" | "warning" | "review" | "neutral" | "danger";
  action: { label: string; kind: "practise" | "resume" | "subscribe" | "retry" | "none" };
  progress: number | null;       // attempt progress 0-100, only for a stored unfinished attempt with known totals
};

export const freeAllowanceUsed = (access: MyAccess | null | undefined) => Boolean(access?.gated && !access.subscribed && access.exhausted);

export function subjectCardView(input: SubjectCardInput): SubjectCardView {
  const none = { label: "", kind: "none" as const };
  if (input.loading) return { state: "LOADING", status: null, tone: "neutral", action: none, progress: null };
  if (input.error) return { state: "ERROR", status: "Could not load this subject", tone: "danger", action: { label: "Try again", kind: "retry" }, progress: null };
  if (input.available != null && input.available <= 0) return { state: "CONTENT_UNAVAILABLE", status: "No questions published yet", tone: "neutral", action: none, progress: null };
  if (input.attempt?.id) {
    const total = Number(input.attempt.total ?? 0), answered = Number(input.attempt.answered ?? 0);
    const progress = total > 0 ? Math.max(0, Math.min(100, Math.round((answered / total) * 100))) : null;
    return { state: "UNFINISHED", status: total > 0 ? `${answered} of ${total} answered` : "Unfinished practice", tone: "warning", action: { label: "Resume", kind: "resume" }, progress };
  }
  if (freeAllowanceUsed(input.access)) return { state: "ACCESS_REQUIRED", status: "Free practice used", tone: "neutral", action: { label: "See plans", kind: "subscribe" }, progress: null };
  if (input.weak) return { state: "REVISION_RECOMMENDED", status: "Worth revising", tone: "review", action: { label: "Practise", kind: "practise" }, progress: null };
  if (input.nextTopic) return { state: "NEXT_TOPIC", status: `Next: ${input.nextTopic.title}`, tone: "info", action: { label: "Start", kind: "practise" }, progress: null };
  if (Number(input.evidence ?? 0) > 0) return { state: "READY", status: "Ready", tone: "info", action: { label: "Practise", kind: "practise" }, progress: null };
  return { state: "UNSTARTED", status: "Not started", tone: "neutral", action: { label: "Practise", kind: "practise" }, progress: null };
}
