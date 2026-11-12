import type { AttemptResult } from "@/lib/challenges/types";

// What a player sees after finishing a challenge: each question, the option they chose and the correct option written out (not just a letter), and the explanation if there is one.
// The questions are the ones the player was just shown; the review is what the database returned on submitting. Rows follow the order the questions were played in.
export type PlayedQuestion = { id: string; question_text: string; options: string[] };
export type ReviewRow = { id: string; number: number; text: string; state: "correct" | "incorrect" | "unanswered"; chosen: string | null; correct: string; explanation: string | null };

const labelled = (options: string[], index: number | null) => (index === null || index < 0 || index >= options.length ? null : `${String.fromCharCode(65 + index)}. ${options[index]}`);

export function buildReview(questions: PlayedQuestion[], review: NonNullable<AttemptResult["review"]>): ReviewRow[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return review.map((r, i) => {
    const q = byId.get(r.question_id);
    const options = q?.options ?? [];
    return {
      id: r.question_id, number: i + 1, text: q?.question_text ?? `Question ${i + 1}`,
      state: r.is_correct ? "correct" : r.chosen_index === null ? "unanswered" : "incorrect",
      chosen: labelled(options, r.chosen_index),
      correct: labelled(options, r.correct_index) ?? String.fromCharCode(65 + r.correct_index),
      explanation: r.explanation?.trim() || null,
    };
  });
}
