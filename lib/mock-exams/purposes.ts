// What a mock exam is for. The purpose is a label the author chooses; it changes nothing about how the exam is built or marked.
// "BECE readiness" and "WASSCE readiness" are labels only: the repository holds no WAEC syllabus mapping, so QuizBox does not claim an exam matches a WAEC paper.
export const PURPOSES = [
  { value: "practice", label: "Practice", hint: "Open practice across several years." },
  { value: "promotion", label: "Promotion exam", hint: "Decides who moves up to the next class." },
  { value: "end_of_term", label: "End of term", hint: "Covers the term's work and earlier foundations." },
  { value: "bece_readiness", label: "BECE readiness", hint: "A label only. Topics come from the curriculum you choose, not from a WAEC syllabus." },
  { value: "wassce_readiness", label: "WASSCE readiness", hint: "A label only. Topics come from the curriculum you choose, not from a WAEC syllabus." },
  { value: "other", label: "Other", hint: "" },
] as const;
export type Purpose = (typeof PURPOSES)[number]["value"];
export const purposeLabel = (v: string): string => PURPOSES.find((p) => p.value === v)?.label ?? v;
export const isWaecLabel = (v: string): boolean => v === "bece_readiness" || v === "wassce_readiness";
