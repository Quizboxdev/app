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

// Curriculum documents print topic names in capitals ("HEAT"). A name with no lower-case letter is shown in title case ("Heat"); anything already
// mixed-case is left exactly as written. Display only: stored data is never changed.
const SMALL_WORDS = new Set(["and", "of", "the", "in", "to", "for", "on", "a", "an", "or", "with", "at", "by"]);
const ACRONYMS = new Set(["ict", "icts", "ms", "pe", "hiv", "aids", "dna", "rna", "gps", "www", "usb", "cpu", "ram", "rom", "sms", "uk", "usa", "gdp", "dc", "ac", "am", "fm", "cd", "tv", "ii", "iii", "iv"]);
export function niceTitle(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t || /[a-z]/.test(t)) return t;
  const cap = (seg: string) => (ACRONYMS.has(seg.toLowerCase().replace(/[^a-z]/g, "")) ? seg.toUpperCase() : seg.toLowerCase().replace(/^([("']?)([a-zà-ÿ])/, (_m, p: string, c: string) => p + c.toUpperCase()));
  return t.split(" ").map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.split(/([-/])/).map((seg) => (seg === "-" || seg === "/" ? seg : cap(seg))).join(""))).join(" ");
}

// The words to show for a topic: its own title, or, when the title is a code or placeholder, the wording of its learning indicator.
// null means there is nothing readable to show.
export function topicLabel(t: { title?: string | null; indicator?: string | null }, max = 90): string | null {
  if (!looksLikeCode(t.title)) return tidy(niceTitle(t.title), max);
  if (!looksLikeCode(t.indicator)) return tidy(t.indicator as string, max);
  return null;
}

// An objective (learning indicator) in a menu: its wording, never its code. Falls back to the code only when nothing else exists.
export function objectiveLabel(o: { title?: string | null; code?: string | null }, max = 110): string {
  if (!looksLikeCode(o.title)) return tidy(o.title as string, max);
  return "Objective";
}

// A trail of readable names (codes and placeholders dropped), joined with arrows. Teachers and learners are given the topic only, never the strand above it.
export const curriculumTrail = (parts: Array<string | null | undefined>): string =>
  parts.filter((p): p is string => !looksLikeCode(p)).map((p) => tidy(niceTitle(p), 60)).join(" › ");

// Teachers choose topics, not strands. Where a list is made of strands, replace each strand by the topics (sub-strands) inside it; the strand is kept as `via`
// so question filters stay exact, but it is never shown. A strand with nothing inside it stays in the list as itself, and other node types are untouched.
export function topicsInsteadOfStrands<T extends { node_type: string }>(nodes: T[], childrenOf: (strand: T) => T[]): Array<T & { via?: T }> {
  return nodes.flatMap((n): Array<T & { via?: T }> => {
    if (n.node_type !== "strand") return [n];
    const inside = childrenOf(n);
    return inside.length ? inside.map((c) => ({ ...c, via: n })) : [n];
  });
}

// Plain names for the curriculum levels in headings and filters. The curriculum's own words win only when they are not a bare code.
const LEVEL_NAMES: Record<string, string> = {
  education_level: "Level", grade: "Grade", subject: "Subject", strand: "Area", sub_strand: "Topic", topic: "Topic", subtopic: "Subtopic",
  content_standard: "What learners should know", learning_indicator: "Objective", learning_objective: "Objective",
};
export const levelDisplayName = (nodeType: string, sourceTerminology?: string | null): string =>
  LEVEL_NAMES[nodeType] ?? (sourceTerminology && !looksLikeCode(sourceTerminology) ? sourceTerminology : "Topic");

type Topicish = { title?: string | null; indicator?: string | null };
// Splits a class's topics into those a teacher can read and those that cannot be labelled yet (reported to admins, never shown as "Other").
// The strand is deliberately not offered: a teacher chooses topics, not strands.
export function splitTopicsForTeacher<T extends Topicish>(topics: T[]): { shown: Array<T & { label: string }>; unlabelled: T[] } {
  const shown: Array<T & { label: string }> = [], unlabelled: T[] = [];
  for (const t of topics) {
    const label = topicLabel(t);
    if (label === null) unlabelled.push(t);
    else shown.push({ ...t, label });
  }
  return { shown, unlabelled };
}
