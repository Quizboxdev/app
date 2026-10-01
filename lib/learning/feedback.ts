export interface PracticeFeedback {
  question_id: string;
  is_correct: boolean;
  selected_answer: string | null;
  selected_value: unknown;
  correct_answer: string | null;
  explanation?: string | null;
  hint?: string | null;
  marks_awarded: number;
}

export function canRevealPracticeFeedback(mode: string, questionId: string, feedback?: PracticeFeedback) {
  return mode === "PRACTICE" && feedback?.question_id === questionId;
}
