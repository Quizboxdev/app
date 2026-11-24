import { keyOf } from "../curriculum/verified";

// Which approved source a question file was written from, judged by the file's subject column. The loader stamps every ticked source on every
// question in the file, so ticking all of them (the old default) recorded a dozen sources on a one-subject file. This picks the matching one.
// Source titles read like "History of Ghana B1-B6 Standards-Based Curriculum" and files say "History": words that do not name a subject are ignored, and
// the file's subject must be contained in the title's words (or the reverse).
const FILLER = new Set(["of", "and", "the", "for", "in", "upper", "lower", "primary", "junior", "high", "school", "jhs", "shs", "year", "ghana", "language", "education",
  "standards", "based", "curriculum", "syllabus", "common", "core", "programme"]);
const ALIASES: Record<string, string> = { rme: "religious moral", ict: "information communication technology", pe: "physical" };

// "Information and Communications Technology" (the file's subject) and "ICT Curriculum" (the source) differ only by an s: one stem for both.
const STEM: Record<string, string> = { communications: "communication" };
const words = (text: string): string[] => keyOf(text).split(" ").flatMap((w) => (ALIASES[w] ?? w).split(" "))
  .map((w) => STEM[w] ?? w).filter((w) => w && !FILLER.has(w) && !/^(b|shs|jhs)?\d+$/.test(w));

export function sourceMatchesSubject(sourceTitle: string, fileSubject: string): boolean {
  const s = words(sourceTitle), f = words(fileSubject);
  if (!s.length || !f.length) return false;
  return f.every((w) => s.includes(w)) || s.every((w) => f.includes(w));
}

// The ids of the sources that match any of the file's subjects (empty when none do, so the admin must choose).
export function sourcesForSubjects(sources: Array<{ id: string; title: string }>, subjects: string[]): string[] {
  return sources.filter((src) => subjects.some((sub) => sourceMatchesSubject(src.title, sub))).map((src) => src.id);
}
