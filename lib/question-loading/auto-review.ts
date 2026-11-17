import type { BatchPreview, SampleQuestion } from "@/lib/api/owner";

// The rule check the scheduled loader (scripts/question-bank/auto-load.ts) applies to the random sample that Admin > Question batches would show a person.
// It is a set of mechanical rules, not a reading: it cannot tell whether a marked answer is true. That is why the approval it leads to is recorded as SCRIPT_CHECKED
// (no human_reviewed stamp, a note saying no person read the sample), never as an owner approval.
export type Verdict = { pass: boolean; checked: number; flags: string[]; note: string };

const LETTERS = ["a", "b", "c", "d"] as const;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const MIN_SHARED_ENDING = 12;      // characters: a phrase this long stuck on the end of wrong options only is a giveaway
const MAX_LONGEST_SHARE = 0.7;     // the right answer being the longest option in more than 70% of a sample (chance is 25%, a clean bank sits near 33%)
const MAX_LETTER_SHARE = 0.6;      // one answer letter carrying more than 60% of the sample
const MIN_VALID_SHARE = 0.98;      // questions of the batch that pass the database's own checks

// The longest ending (whole words) that every option in `texts` shares, ignoring case.
function sharedEnding(texts: string[]): string {
  if (texts.length < 2) return "";
  const words = texts.map((t) => t.trim().split(/\s+/));
  let i = 1;
  while (words.every((w) => w.length >= i && w[w.length - i].toLowerCase() === words[0][words[0].length - i].toLowerCase())) i++;
  return i === 1 ? "" : words[0].slice(words[0].length - (i - 1)).join(" ");
}

export function questionFlags(q: SampleQuestion): string[] {
  const out: string[] = [];
  const options = LETTERS.map((k) => ({ k, text: (q[k] ?? "").trim() })).filter((o) => o.text);
  if (norm(q.question ?? "").length < 10) out.push("question text missing or too short");
  if (options.length < 2) out.push("fewer than two options");
  const correct = options.find((o) => o.k.toUpperCase() === q.correct);
  if (!correct) out.push("marked answer does not point at an option");
  if (new Set(options.map((o) => norm(o.text))).size < options.length) out.push("two options say the same thing");
  if (correct) {
    const wrong = options.filter((o) => o !== correct).map((o) => o.text);
    const ending = sharedEnding(wrong);
    if (wrong.length >= 2 && ending.length >= MIN_SHARED_ENDING && !correct.text.toLowerCase().endsWith(ending.toLowerCase())) out.push(`wrong options share an ending the right one lacks ("${ending.slice(0, 40)}")`);
    if (norm(q.question) && norm(correct.text).length >= 12 && norm(q.question).includes(norm(correct.text))) out.push("the question already contains the right answer");
  }
  return out;
}

export function reviewSample(p: Pick<BatchPreview, "file" | "questions_found" | "would_approve" | "already_available_to_learners" | "min_sample_required" | "sample">): Verdict {
  const flags: string[] = [];
  const sample = p.sample ?? [], n = sample.length, need = p.min_sample_required ?? 20;
  if (p.would_approve <= 0) flags.push("nothing in this batch can be approved");
  if (p.already_available_to_learners > 0) flags.push(`${p.already_available_to_learners} of its questions are already live`);
  if (n < need) flags.push(`sample has ${n} questions, ${need} are required (batch too small for the script to approve)`);
  if (p.questions_found > 0 && p.would_approve / p.questions_found < MIN_VALID_SHARE) flags.push(`only ${p.would_approve} of ${p.questions_found} pass the database checks`);
  sample.forEach((q, i) => { for (const f of questionFlags(q)) flags.push(`sample ${i + 1}: ${f}`); });
  if (new Set(sample.map((q) => norm(q.question))).size < n) flags.push("the same question appears twice in the sample");
  // Two-option (true or false) questions are skipped here: with two options the right one is the longer or the first by chance half the time.
  const fourOptions = sample.filter((q) => LETTERS.filter((k) => (q[k] ?? "").trim()).length >= 3).length;
  if (n >= need && fourOptions >= 0.8 * n) {
    const longest = sample.filter((q) => {
      const lens = LETTERS.map((k) => ({ k, len: (q[k] ?? "").trim().length })), c = lens.find((l) => l.k.toUpperCase() === q.correct);
      return !!c && lens.every((l) => l.k === c.k || l.len < c.len);
    }).length;
    if (longest / n > MAX_LONGEST_SHARE) flags.push(`the right answer is the longest option in ${longest} of ${n} questions`);
    for (const letter of ["A", "B", "C", "D"]) { const share = sample.filter((q) => q.correct === letter).length; if (share / n > MAX_LETTER_SHARE) flags.push(`answer ${letter} is correct in ${share} of ${n} questions`); }
  }
  const pass = flags.length === 0;
  const note = (pass
    ? `Script check (no human read): ${n} of ${p.questions_found} questions sampled from ${p.file}; every question passed the 6 per-question rules and the batch-level checks, 0 flagged. Answers were not verified by a person or a subject expert.`
    : `Script check failed: ${flags.length} flag(s). ${flags.slice(0, 5).join("; ")}`).slice(0, 1000);
  return { pass, checked: n, flags, note };
}
