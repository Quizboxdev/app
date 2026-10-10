// Plain-language texts for assigning work by topic. Merged into lib/errors.ts.
export const TOPIC_ASSIGNMENT_MESSAGES: Record<string, string> = {
  QB_TOPIC_COUNT_INVALID: "Choose between 1 and 20 topics.",
  QB_TOPIC_TOTAL_INVALID: "The total must be at least the number of topics chosen, and at most 100.",
  QB_TOPIC_DIFFICULTY_INVALID: "Difficulty must be easy, medium or hard.",
  QB_TOPIC_UNAVAILABLE: "One of the chosen topics is not open for assignments in this class.",
  QB_TOPIC_SHORT: "A topic does not have enough approved questions for its share. Reduce the total, remove that topic, or choose mixed difficulty",
  CLASS_NOT_FOUND: "That class was not found.",
};
