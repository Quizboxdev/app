import { createHash } from "node:crypto";
import { normalize, type Candidate } from "./contract";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function signatures(q: Candidate) {
  const options = [q.option_a, q.option_b, q.option_c, q.option_d].map(normalize);
  const correctText = options["ABCD".indexOf(q.correct_answer)] ?? JSON.stringify(q.answer_spec);
  const text = normalize(q.question_text);
  return { text: hash(text), answer: hash(`${text}|${correctText}`), options: hash(`${text}|${[...options].sort().join("|")}|${correctText}`) };
}
export function similarity(a: string, b: string): number {
  const x = new Set(normalize(a).split(" ").filter(Boolean)), y = new Set(normalize(b).split(" ").filter(Boolean));
  const union = new Set([...x, ...y]); return union.size ? [...x].filter((word) => y.has(word)).length / union.size : 0;
}
export function duplicateWarnings(candidate: Candidate, existing: Candidate[]) {
  const sig = signatures(candidate);
  return existing.flatMap((other) => {
    if (other.external_question_id === candidate.external_question_id) return [];
    const otherSig = signatures(other);
    const exact = sig.text === otherSig.text || sig.answer === otherSig.answer || sig.options === otherSig.options;
    const near = similarity(candidate.question_text, other.question_text);
    return exact || near >= 0.85 ? [{ externalId: other.external_question_id, group: `dup-${[sig.text, otherSig.text].sort()[0]}`, kind: exact ? "exact" : "near", similarity: near }] : [];
  });
}
