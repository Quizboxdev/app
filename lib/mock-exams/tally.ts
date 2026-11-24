// The running tally of a mock exam while it is built, and what the author should do next. Pure functions over the numbers the database returns; the database is the one that enforces every limit.
export type Totals = { desired: number; allocated: number; selected: number; remaining_to_allocate: number; remaining_to_select: number };
export type RoundState = { id: string; position: number; grade_code: string; subject_code: string; subject_label: string; topic_id: string; topic_title: string; strand?: string; indicator_code?: string;
  requested: number; selected: number; available: number; available_to_add: number; shortfall: number };

export type RoundHealth = "empty" | "partial" | "full" | "short";
// short = this round can never be filled as asked (not enough different approved questions left in its topic).
export function roundHealth(r: Pick<RoundState, "requested" | "selected" | "available_to_add">): RoundHealth {
  if (r.selected >= r.requested) return "full";
  if (r.available_to_add < r.requested - r.selected) return "short";
  return r.selected === 0 ? "empty" : "partial";
}
export function roundMessage(r: RoundState): string {
  const h = roundHealth(r);
  if (h === "full") return `${r.selected} of ${r.requested} chosen.`;
  if (h === "short") {
    const have = r.available_to_add + r.selected;
    return `Only ${have} different approved question${have === 1 ? " is" : "s are"} available in this topic, ${r.shortfall} short of the ${r.requested} you asked for.`;
  }
  return `${r.selected} of ${r.requested} chosen. ${r.available_to_add} more available to add.`;
}
// Ways out of a shortfall. Nothing is ever filled from another topic or year automatically.
export type Recovery = "lower_count" | "other_topic" | "add_questions";
export const recoveryOptions = (r: RoundState): Recovery[] => (roundHealth(r) === "short" ? (["lower_count", "other_topic", "add_questions"] as Recovery[]) : []);
export const recoveryLabel: Record<Recovery, string> = {
  lower_count: "Ask for fewer questions in this round",
  other_topic: "Choose another topic or year for the missing questions",
  add_questions: "Ask for more questions to be written and approved for this topic",
};

export const tallyLines = (t: Totals): Array<{ label: string; value: number }> => [
  { label: "Desired", value: t.desired }, { label: "Allocated to rounds", value: t.allocated }, { label: "Chosen", value: t.selected },
  { label: "Still to allocate", value: t.remaining_to_allocate }, { label: "Still to choose", value: t.remaining_to_select },
];
// The most a new round (or an edited one) may ask for.
// A topic can give at most MAX_PER_TOPIC questions to one exam (the database setting mock_exams.max_per_topic; the database is the one that enforces it), and the exam has at most 100 in all.
export const MAX_PER_TOPIC = 10;
export const maxForRound = (t: Totals, ownRequested = 0): number => Math.min(MAX_PER_TOPIC, Math.max(0, t.desired - (t.allocated - ownRequested)));

export type Step = { code: "ADD_ROUND" | "ALLOCATE_MORE" | "PICK" | "FIX_SHORTFALL" | "REVIEW"; round?: number; count?: number };
export function nextStep(t: Totals, rounds: RoundState[]): Step {
  if (!rounds.length) return { code: "ADD_ROUND" };
  const short = rounds.find((r) => roundHealth(r) === "short");
  if (short) return { code: "FIX_SHORTFALL", round: short.position, count: short.shortfall };
  if (t.remaining_to_allocate > 0) return { code: "ALLOCATE_MORE", count: t.remaining_to_allocate };
  const open = rounds.find((r) => r.selected < r.requested);
  if (open) return { code: "PICK", round: open.position, count: open.requested - open.selected };
  return { code: "REVIEW" };
}
export function stepText(s: Step): string {
  const n = s.count ?? 0, q = `${n} question${n === 1 ? "" : "s"}`;
  switch (s.code) {
    case "ADD_ROUND": return "Add your first round: a year, a subject, a topic and how many questions.";
    case "ALLOCATE_MORE": return `Add another round for the remaining ${q}.`;
    case "PICK": return `Choose ${q} for round ${s.round}.`;
    case "FIX_SHORTFALL": return `Round ${s.round} is ${n} short. Lower its count, choose another topic, or ask for more questions to be written.`;
    default: return "Every round is filled. Review the exam and publish it.";
  }
}

// Words for the codes qb_mock_exam_review returns.
export type Issue = { code: string; count?: number; round?: number };
export function issueText(i: Issue): string {
  const n = i.count ?? 0;
  switch (i.code) {
    case "TOO_FEW_QUESTIONS": return `The exam is smaller than the minimum (${n} questions).`;
    case "NO_ROUNDS": return "Add at least one round.";
    case "NOT_FULLY_ALLOCATED": return `${n} question${n === 1 ? " is" : "s are"} still to be allocated to a round.`;
    case "ROUND_NOT_FILLED": return `Round ${i.round} still needs ${n} question${n === 1 ? "" : "s"}.`;
    case "QUESTION_UNAVAILABLE": return `${n} chosen question${n === 1 ? " is" : "s are"} no longer approved or available. Choose them again.`;
    case "DUPLICATE_QUESTIONS": return `${n} chosen question${n === 1 ? " repeats" : "s repeat"} another one.`;
    default: return "Something needs attention.";
  }
}
