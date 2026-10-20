// What a teacher or learner is allowed to see as a curriculum label. A label is real only when it is wording (a node title); a code
// ("B5.1.2.3"), a bare level name ("Strand") or an empty string is not. Covers everything public.qb_label_is_code in the database catches, plus dotted SHS codes.
// Display only: stored data is never changed.
const CODE_LIKE = /^(strand|sub-?strand|topic|unit)?\s*[a-z]{0,4}\s*[0-9]+([.:][0-9]+)*\.?$/i;
const LEVEL_WORD = /^(strand|sub-?strand|topic|unit|content standard|indicator)$/i;
// Dotted codes with letters inside, as the SHS curriculum prints them ("1.2.1.LI.1"); needs a digit and no spaces.
const DOTTED_CODE = /^(?=.*[0-9])[a-z0-9]+(\.[a-z0-9]+)+\.?$/i;

export const looksLikeCode = (text: string | null | undefined): boolean => {
  const t = (text ?? "").trim();
  return t === "" || CODE_LIKE.test(t) || LEVEL_WORD.test(t) || DOTTED_CODE.test(t);
};

const tidy = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

// The words to show for a topic: its own title, or, when the title is a code or placeholder, the wording of its learning indicator.
// null means there is nothing readable to show.
export function topicLabel(t: { title?: string | null; indicator?: string | null }, max = 90): string | null {
  if (!looksLikeCode(t.title)) return tidy(t.title as string, max);
  if (!looksLikeCode(t.indicator)) return tidy(t.indicator as string, max);
  return null;
}

// A strand is only ever a small hint beside a topic, and only when it is wording.
export const strandHint = (strand: string | null | undefined): string | null => (looksLikeCode(strand) ? null : tidy(strand as string, 60));

// An objective (learning indicator) in a menu: its wording, never its code. Falls back to the code only when nothing else exists.
export function objectiveLabel(o: { title?: string | null; code?: string | null }, max = 110): string {
  if (!looksLikeCode(o.title)) return tidy(o.title as string, max);
  return "Objective";
}

// "Strand › Sub-strand" style trail with the codes and placeholders dropped.
export const curriculumTrail = (parts: Array<string | null | undefined>): string =>
  parts.filter((p): p is string => !looksLikeCode(p)).map((p) => tidy(p, 60)).join(" › ");

// Plain names for the curriculum levels in headings and filters. The curriculum's own words win only when they are not a bare code.
const LEVEL_NAMES: Record<string, string> = {
  education_level: "Level", grade: "Grade", subject: "Subject", strand: "Area", sub_strand: "Topic area", topic: "Topic", subtopic: "Subtopic",
  content_standard: "What learners should know", learning_indicator: "Objective", learning_objective: "Objective",
};
export const levelDisplayName = (nodeType: string, sourceTerminology?: string | null): string =>
  LEVEL_NAMES[nodeType] ?? (sourceTerminology && !looksLikeCode(sourceTerminology) ? sourceTerminology : "Topic");

type Topicish = { title?: string | null; indicator?: string | null; strand?: string | null };
// Splits a class's topics into those a teacher can read and those that cannot be labelled yet (reported to admins, never shown as "Other").
export function splitTopicsForTeacher<T extends Topicish>(topics: T[]): { shown: Array<T & { label: string; hint: string | null }>; unlabelled: T[] } {
  const shown: Array<T & { label: string; hint: string | null }> = [], unlabelled: T[] = [];
  for (const t of topics) {
    const label = topicLabel(t);
    if (label === null) unlabelled.push(t);
    else { const hint = strandHint(t.strand); shown.push({ ...t, label, hint: hint && hint.toLowerCase() !== label.toLowerCase() ? hint : null }); }
  }
  return { shown, unlabelled };
}
