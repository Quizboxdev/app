// Pure rules for a test built from sections (a subject, its topics or "any topic", and a number of questions). The database decides and enforces;
// these helpers only keep the screen honest (which classes may combine subjects, how a total is shared, what is sent).
export type Level = "PRIMARY" | "JHS" | "SHS" | "OTHER";

// Mirrors quizbox_topic.class_level in the database: B1 to B6 Primary, B7 to B9 JHS, B10 / SHS1 to SHS3 Senior High.
export function classLevel(grade?: string | null, educationLevel?: string | null): Level {
  const g = (grade ?? "").trim().toUpperCase();
  if (/^B[1-6]$/.test(g)) return "PRIMARY";
  if (/^B[7-9]$/.test(g)) return "JHS";
  if (/^(B10|SHS ?[1-3])$/.test(g)) return "SHS";
  const e = (educationLevel ?? "").toLowerCase();
  if (/primary/.test(e)) return "PRIMARY";
  if (/(jhs|junior)/.test(e)) return "JHS";
  if (/(shs|senior)/.test(e)) return "SHS";
  return "OTHER";
}
// A test with more than one subject: Primary and JHS only.
export const canCombineSubjects = (level: Level) => level === "PRIMARY" || level === "JHS";

export const MAX_SECTIONS = 8, MAX_TOTAL = 100, MAX_TOPICS_PER_SECTION = 20;

export type SectionDraft = { subject: string; mode: "any" | "pick"; topicIds: string[]; quota: number; difficulty?: "" | "easy" | "medium" | "hard" };
export type ApiSection = { subject: string; quota: number; topic_ids?: string[]; difficulty?: string };

// A total shared evenly over n sections; the first sections take the remainder.
export function splitEvenly(total: number, n: number): number[] {
  if (n < 1) return [];
  const t = Math.max(n, Math.floor(total));
  const base = Math.floor(t / n), rem = t % n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}
export const totalOf = (sections: Pick<SectionDraft, "quota">[]) => sections.reduce((n, s) => n + (Number.isFinite(s.quota) ? s.quota : 0), 0);

export function toApiSections(sections: SectionDraft[]): ApiSection[] {
  return sections.map((s) => ({
    subject: s.subject, quota: s.quota,
    ...(s.mode === "pick" && s.topicIds.length ? { topic_ids: s.topicIds } : {}),
    ...(s.difficulty ? { difficulty: s.difficulty } : {}),
  }));
}

// What the teacher still has to fix before a preview can be asked for; empty means ready. Plain wording, shown beside the section.
export function sectionProblems(sections: SectionDraft[], level: Level): string[] {
  const out: string[] = [];
  if (sections.length === 0) return ["Choose at least one subject."];
  if (sections.length > MAX_SECTIONS) out.push(`Use at most ${MAX_SECTIONS} subjects.`);
  if (sections.length > 1 && !canCombineSubjects(level)) out.push("A test with more than one subject is for Primary and JHS classes.");
  for (const s of sections) {
    if (!Number.isInteger(s.quota) || s.quota < 1) out.push(`${s.subject}: choose how many questions.`);
    else if (s.mode === "pick" && s.topicIds.length === 0) out.push(`${s.subject}: tick at least one topic, or choose any topic.`);
    else if (s.mode === "pick" && s.quota < s.topicIds.length) out.push(`${s.subject}: ${s.topicIds.length} topics need at least ${s.topicIds.length} questions.`);
    else if (s.topicIds.length > MAX_TOPICS_PER_SECTION) out.push(`${s.subject}: choose at most ${MAX_TOPICS_PER_SECTION} topics.`);
  }
  if (totalOf(sections) > MAX_TOTAL) out.push(`A test can have at most ${MAX_TOTAL} questions in all.`);
  return out;
}

// How a learner's score in one subject or topic is described. The cut-off matches the result page's "area to work on" (under 68%).
export type Band = { key: "strong" | "getting-there" | "needs-work"; label: string; tone: "success" | "info" | "amber" };
export function breakdownBand(percent: number): Band {
  if (percent >= 85) return { key: "strong", label: "Strong", tone: "success" };
  if (percent >= 68) return { key: "getting-there", label: "Getting there", tone: "info" };
  return { key: "needs-work", label: "Needs more practice", tone: "amber" };
}

// Draft saved before sections existed (one subject, ticked topics, one total) becomes a single section.
export function sectionsFromLegacyDraft(v: { subject?: string; chosen?: string[]; total?: number }): SectionDraft[] {
  if (!v.subject) return [];
  const chosen = v.chosen ?? [];
  return [{ subject: v.subject, mode: chosen.length ? "pick" : "any", topicIds: chosen, quota: Math.max(1, Math.floor(v.total ?? 10)) }];
}
