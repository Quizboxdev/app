// The one question-loading template (docs/question-loading/). Admin-only; see docs/question-loading/DESIGN.md.
export const LOAD_COLUMNS = ["level", "grade", "subject", "strand", "sub_strand", "indicator_code", "topic", "concept", "difficulty", "cognitive_level", "answer_type",
  "question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation", "source_reference", "source_quote"] as const;
export type LoadColumn = typeof LOAD_COLUMNS[number];
export type LoadRow = Record<LoadColumn, string>;

// A batch targets either an approved curriculum bank or one sponsor request's approved document.
export type LoadScope = "CURRICULUM" | "SPONSOR";

export const LEVELS = ["PRIMARY", "JHS", "SHS", "SPONSOR"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const COGNITIVE_LEVELS = ["Remember", "Understand", "Apply", "Analyse", "Evaluate"] as const;
export const ANSWER_TYPES = ["SINGLE_CHOICE", "TRUE_FALSE"] as const;

// Columns every file must carry, whatever the scope.
export const REQUIRED_COLUMNS: readonly LoadColumn[] = ["level", "difficulty", "cognitive_level", "answer_type", "question_text", "option_a", "option_b", "correct_answer", "explanation", "source_reference"];
// Teachers teach topics, not chapters: a topic is a unit taught in one to three lessons. The loader expects a full block of
// questions per topic so a teacher can assign a topic, or spread an assignment evenly across several topics.
export const TOPIC_BLOCK_SIZE = 50;
export const MAX_FILE_BYTES = 10_000_000;
export const MAX_FILE_ROWS = 5_000;
