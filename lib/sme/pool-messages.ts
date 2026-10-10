// Plain-language texts for the review pool's codes. Merged into lib/errors.ts.
export const POOL_MESSAGES: Record<string, string> = {
  QB_PICK_COUNT_INVALID: "Choose at least one question to pick.",
  DAILY_CAP_REACHED: "You have reached today's limit. More questions open tomorrow.",
  OPEN_QUEUE_FULL: "You are holding the most questions allowed at once. Finish or return some, then pick more.",
  POOL_EMPTY: "There are no more questions waiting for your subjects right now.",
};
