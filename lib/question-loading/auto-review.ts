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
const MAX_FLAGGED_SHARE = 0.01;    // whole file: more than 1% of its rows matching a per-question rule holds the file for a person
// A long option ending on one of these words was cut off (the AI stopped writing mid-sentence): "...to seek confirmation of".
const DANGLING = new Set(["of", "the", "a", "an", "and", "or", "with", "that", "which", "as", "than", "because", "so", "but", "its", "their", "his", "her", "between", "through", "into", "is", "are", "was", "were"]);      // questions of the batch that pass the database's own checks

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
  const cut = options.find((o) => o.text.length >= 40 && DANGLING.has((o.text.split(/\s+/).pop() ?? "").toLowerCase()));
  if (cut) out.push(`an option stops in the middle of a sentence ("...${cut.text.split(/\s+/).slice(-3).join(" ")}")`);
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

// The same per-question rules over EVERY row of a file, not just the sample of 20. A sample of 20 catches a file that is 5% bad but misses one that is 1 to 2% bad.
// Rows are listed so they can be retired or fixed; a file above MAX_FLAGGED_SHARE is held for a person.
export type FileRow = { question_text: string; option_a: string; option_b: string; option_c: string; option_d: string; correct_answer: string };
export type FileVerdict = { rows: number; flagged: { fileRow: number; flags: string[] }[]; share: number; hold: boolean; summary: string };
export function reviewFile(rows: FileRow[], fileRows: number[]): FileVerdict {
  const flagged: FileVerdict["flagged"] = [];
  rows.forEach((r, i) => {
    const flags = questionFlags({ id: String(i), question: r.question_text, a: r.option_a, b: r.option_b, c: r.option_c, d: r.option_d, correct: (r.correct_answer ?? "").trim().toUpperCase(), difficulty: null });
    if (flags.length) flagged.push({ fileRow: fileRows[i] ?? i + 2, flags });
  });
  // A bank written by a generator with a fixed word budget has options of almost the same length (B6 English: 14 to 16 words in 99.9% of options), which means
  // short options were padded with filler and long ones were cut off. Real banks have options of many lengths.
  const words = rows.flatMap((r) => [r.option_a, r.option_b, r.option_c, r.option_d]).map((o) => (o ?? "").trim().split(/\s+/).filter(Boolean).length).filter((w) => w > 1);
  let capped = "";
  if (rows.length >= 50 && words.length >= 200) {
    let best = 0, from = 0;
    for (let w = 1; w <= 60; w++) { const c = words.filter((x) => x >= w && x <= w + 2).length; if (c > best) { best = c; from = w; } }
    if (from >= 10 && best / words.length >= 0.9) capped = `${(100 * best / words.length).toFixed(0)}% of all options are ${from} to ${from + 2} words long, so they look padded or cut to a fixed length`;
  }
  const share = rows.length ? flagged.length / rows.length : 0, hold = share > MAX_FLAGGED_SHARE || !!capped;
  const kinds: Record<string, number> = {};
  for (const f of flagged) for (const x of f.flags) { const k = x.replace(/\s*\(.*$/, ""); kinds[k] = (kinds[k] ?? 0) + 1; }
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c} x ${k}`).join(", ");
  const summary = (capped ? `${capped}; ` : "") + (flagged.length ? `${flagged.length} of ${rows.length} rows (${(100 * share).toFixed(1)}%) matched a rule: ${top}` : `all ${rows.length} rows passed the per-question rules`);
  return { rows: rows.length, flagged, share, hold, summary };
}
