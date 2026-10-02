const messages: Record<string, string> = {
  "Invalid login credentials": "The email or password is incorrect.",
  "Email not confirmed": "Verify your email before signing in.",
  AUTH_REQUIRED: "Please sign in again.",
  PROFILE_NOT_FOUND: "Your account is awaiting profile setup. Contact your administrator.",
  INVALID_CLASS_CODE: "This class code is not valid.",
  CLASS_NOT_ACTIVE: "This class is not open for enrollment.",
  CLASS_CODE_EXPIRED: "This class code has expired.",
  QB_CONTENT_ACCESS_DENIED: "You do not have permission to manage content.", QB_AUTHENTICATION_REQUIRED: "Please sign in again.",
  QB_CONTENT_CONFLICT: "This item changed while you were reviewing it. Reload it before continuing.",
  QB_HUMAN_REVIEW_REQUIRED: "A human editorial review is required before approval.",
  QB_CONTENT_VALIDATION_FAILED: "This question has validation errors. Correct them before continuing.",
  QB_CONTENT_NOT_APPROVED: "Approve this question before publishing it.", QB_REVIEW_NOTE_REQUIRED: "Enter a review note of at least three characters.",
  QB_CONTENT_RATE_LIMIT: "Too many content requests. Wait a minute and try again.", QB_INVALID_BATCH: "The candidate batch is invalid or exceeds 100 questions.",
  QB_ATTEMPT_NOT_ACTIVE: "This attempt has finished. Open its result instead.", QB_ATTEMPT_TIME_EXPIRED: "Your time has expired.",
  QB_ATTEMPT_OWNERSHIP_DENIED: "This attempt is not available to your account.", QB_ASSESSMENT_RECIPIENT_DENIED: "This assessment is not assigned to you.",
  QB_MAX_ATTEMPTS_REACHED: "You have used all attempts for this assessment.", QB_ASSESSMENT_NOT_OPEN: "This assessment is not open yet.", QB_ASSESSMENT_EXPIRED: "This assessment has closed.",
  CLASS_ACCESS_DENIED: "You do not have access to this class.", INSUFFICIENT_APPROVED_QUESTIONS: "There are not enough approved questions for this objective.",
  QB_ASSIGNMENT_CONTEXT_MISMATCH: "This assessment is not available in the selected class.",
  QB_INVALID_GENERATION_SPEC: "The generation specification does not match the curriculum or allowed limits.",
  QB_INVALID_SELECTION: "Select the requested number of distinct approved questions.",
  QB_INSUFFICIENT_APPROVED_QUESTIONS: "There are not enough approved questions for this objective.",
};
export function userFacingError(error: unknown): string {
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
  return messages[message.split(":")[0]] ?? "The operation could not be completed. Please try again or contact support.";
}
