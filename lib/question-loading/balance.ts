import { normaliseRow } from "./check";
import type { LoadRow } from "./template";

// Evens out the correct-answer letters of multiple-choice rows by moving whole option texts (never just the letter).
// Deterministic for a given seed. Rows whose wording points at option positions are left alone and reported.
export type BalanceReport = { eligible: number; moved: number; skipped: number[]; before: Record<string, number>; after: Record<string, number> };
const POSITIONAL = /\b(both|neither)\s+[a-d]\s+(and|nor)\s+[a-d]\b|\b(option|choice|answer)s?\s+\(?[a-d]\)?\b|\b(all|none|both|neither)\b[^.]{0,20}\b(above|below|options?)\b|\b(first|second|third|fourth|last|previous|preceding|following)\s+(option|choice|answer)\b/i;

function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const count = (letters: string[]) => letters.reduce<Record<string, number>>((acc, l) => { acc[l] = (acc[l] ?? 0) + 1; return acc; }, { A: 0, B: 0, C: 0, D: 0 });

// Equal counts of A-D, shuffled, with no letter more than twice in a row.
export function targetLetters(n: number, seed = 1): string[] {
  const random = prng(seed), pool = Array.from({ length: n }, (_, i) => "ABCD"[i % 4]);
  for (let attempt = 0; attempt < 50; attempt++) {
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (let i = 2; i < pool.length; i++) if (pool[i] === pool[i - 1] && pool[i] === pool[i - 2]) {
      const j = pool.findIndex((x, k) => k > i && x !== pool[i] && (k + 2 >= pool.length || !(x === pool[k + 1] && x === pool[k + 2])) && !(x === pool[i - 1] && x === pool[i - 2]));
      if (j > 0) [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (!pool.some((x, i) => i >= 2 && x === pool[i - 1] && x === pool[i - 2])) break;
  }
  return pool;
}

export function balanceAnswerKey(input: LoadRow[], seed = 1): { rows: LoadRow[]; report: BalanceReport } {
  const rows = input.map(normaliseRow), skipped: number[] = [], eligibleIdx: number[] = [];
  rows.forEach((r, i) => {
    const options = [r.option_a, r.option_b, r.option_c, r.option_d];
    if (r.answer_type !== "SINGLE_CHOICE" || !"ABCD".includes(r.correct_answer) || r.correct_answer.length !== 1 || options.some((o) => !o)) return;
    if (POSITIONAL.test(r.explanation) || options.some((o) => POSITIONAL.test(o)) || POSITIONAL.test(r.question_text)) { skipped.push(i); return; }
    eligibleIdx.push(i);
  });
  const before = count(eligibleIdx.map((i) => rows[i].correct_answer)), targets = targetLetters(eligibleIdx.length, seed);
  let moved = 0;
  eligibleIdx.forEach((i, k) => {
    const r = rows[i], options = [r.option_a, r.option_b, r.option_c, r.option_d], current = "ABCD".indexOf(r.correct_answer), target = "ABCD".indexOf(targets[k]);
    if (current === target) return;
    const right = options[current], others = options.filter((_, j) => j !== current);
    const next = [...others.slice(0, target), right, ...others.slice(target)];
    [r.option_a, r.option_b, r.option_c, r.option_d] = next; r.correct_answer = targets[k]; moved++;
  });
  return { rows, report: { eligible: eligibleIdx.length, moved, skipped: skipped.map((i) => i + 1), before, after: count(eligibleIdx.map((i) => rows[i].correct_answer)) } };
}
