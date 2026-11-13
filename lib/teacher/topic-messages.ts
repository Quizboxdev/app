// Plain-language texts for assigning work by topic. Merged into lib/errors.ts.
export const TOPIC_ASSIGNMENT_MESSAGES: Record<string, string> = {
  QB_TOPIC_COUNT_INVALID: "Choose between 1 and 20 topics.",
  QB_TOPIC_TOTAL_INVALID: "The total must be at least the number of topics chosen, and at most 100.",
  QB_TOPIC_DIFFICULTY_INVALID: "Difficulty must be easy, medium or hard.",
  QB_TOPIC_UNAVAILABLE: "One of the chosen topics is not open for assignments in this class.",
  QB_TOPIC_SHORT: "A topic does not have enough approved questions for its share. Reduce the total, remove that topic, or choose mixed difficulty",
  CLASS_NOT_FOUND: "That class was not found.",
  QB_COMBINED_LEVEL_NOT_ALLOWED: "A test with more than one subject is for Primary and JHS classes. For a Senior High class, choose one subject.",
  QB_BLUEPRINT_SECTIONS_INVALID: "Add between 1 and 8 subjects.",
  QB_BLUEPRINT_DUPLICATE_SUBJECT: "Each subject can appear only once. Put all of its topics in that subject's section.",
  QB_BLUEPRINT_INVALID: "Each subject needs a number of questions, at least 1.",
  QB_BLUEPRINT_QUOTA_TOO_SMALL: "A subject needs at least one question for every topic ticked. Raise its questions or untick topics.",
  QB_BLUEPRINT_ONE_GRADE: "One test uses topics from one grade. Choose topics of the same grade for every subject.",
  QB_FEATURE_DISABLED: "This is not switched on yet.",
  QB_SCHEDULE_LIMIT: "You can keep up to 5 repeating assignments going. Pause or delete one first.",
  INVALID_SCHEDULE_TIME: "Choose a time of day for the weekly assignment, for example 16:00.",
};
