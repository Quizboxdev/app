// Words for the codes the mock-exam functions raise. Shared by the screens and the export route; nothing else from the database is ever shown.
export const MESSAGES: Record<string, string> = {
  QB_AUTHENTICATION_REQUIRED: "Please sign in.", QB_FEATURE_DISABLED: "Mock exams are not open yet.", QB_NOT_FOUND: "We could not find that.",
  QB_MOCK_AUTHOR_FORBIDDEN: "Only teachers and verified sponsors can build mock exams.", QB_MOCK_SPONSOR_NOT_VERIFIED: "Your organisation has to be verified before you can build mock exams.",
  QB_MOCK_INVALID: "Check the details. The title needs at least 5 letters, and the size must be within the allowed range.", QB_MOCK_ARCHIVED: "This exam is archived, so it cannot be changed.",
  QB_MOCK_LEVEL_NOT_ELIGIBLE: "That year cannot feed this exam. Choose the target year or an earlier year of the same stage.", QB_MOCK_TOPIC_INVALID: "That topic does not belong to the chosen year and subject.",
  QB_MOCK_TOPIC_IN_USE: "That topic is already in another round of this exam. Change that round instead.", QB_MOCK_OVER_ALLOCATED: "That is more questions than the exam has room for.",
  QB_MOCK_TOO_MANY_ROUNDS: "The exam already has the most rounds allowed.", QB_MOCK_BELOW_ALLOCATED: "The exam cannot be smaller than the questions already allocated to rounds.",
  QB_MOCK_CURRICULUM_LOCKED: "The curriculum cannot change once rounds exist.", QB_MOCK_ROUNDS_INELIGIBLE: "Some rounds use years above that target year. Change those rounds first.",
  QB_TOPIC_SHORT: "This topic does not have enough different approved questions.", QB_MOCK_QUESTION_INVALID: "One of those questions cannot be used here. Each must come from this round's topic, be approved, and not repeat another question in the exam.",
  QB_MOCK_NOT_READY: "The exam is not ready to publish yet.", QB_MOCK_NO_CHANGES: "Nothing has changed since the last published version.", QB_MOCK_NOT_DELETABLE: "A published exam cannot be deleted. Archive it instead.",
  QB_MOCK_NOT_PUBLISHED: "Publish the exam first.", QB_MOCK_CLASS_ONLY_TEACHERS: "Only teachers can give an exam to a class.", QB_MOCK_CLASS_FORBIDDEN: "You can only assign to a class you teach.",
  QB_MOCK_CLASS_LEVEL_MISMATCH: "That class is at a different stage from this exam (Primary, Junior High or Senior High).", QB_MOCK_DATES_INVALID: "The closing time must be after the opening time.",
  QB_MOCK_VERSION_STALE: "Some questions changed or were withdrawn after this version was published. Build and publish the next version first.",
  QB_TEACHERS_ONLY: "Only teachers and verified organisation sponsors can sell on the Marketplace.", QB_SELLER_SUSPENDED: "Your seller account is paused.", QB_TERMS_REQUIRED: "Please accept the seller terms.", QB_SELLER_INVALID: "Check your details. The phone and account numbers must be digits, and names need at least 2 letters.",
  QB_MOCK_SELL_NOT_ALLOWED: "Only teachers and verified organisation sponsors can sell exams on the Marketplace.", QB_MOCK_TOPIC_CAP: "One topic can give at most 10 questions to an exam. Use another topic for the rest.", QB_NOT_A_SELLER: "Set up your seller account first (Sell question sets).", QB_PRICE_INVALID: "The price must be a whole number of cedis within the Marketplace's limits.",
  QB_ITEM_LOCKED: "This listing is on sale or waiting for review. Take it off sale to change it.", QB_SELLER_NOT_VERIFIED: "Your seller account has not been verified yet. We will tell you when it is.",
  QB_TOO_FEW_QUESTIONS: "The Marketplace needs more questions in an exam before it can be sold.", QB_MOCK_NOT_LISTED: "Prepare the listing first.", QB_MOCK_ITEM_HAS_NO_QUESTION_COPY: "A mock exam listing takes its questions from the exam. They cannot be edited here.",
  QB_MOCK_ENTITLEMENT_REQUIRED: "Your access to this exam has ended or was refunded.", QB_STUDENT_REQUIRED: "Only a learner account can take this exam.", QB_OWN_ITEM: "This is your own exam.",
  QB_ALREADY_OWNED: "You already have this exam.", QB_MINOR_CANNOT_PAY: "Please ask a parent or your teacher to buy this for you.", QB_FORBIDDEN: "You do not have permission to do that.",
  QB_MAX_ATTEMPTS_REACHED: "You have used all your attempts.",
  QB_FAMILY_FORBIDDEN: "You can only give work to children you are linked to with permission to assign work.", QB_MOCK_LINK_SPONSORS_ONLY: "Only verified organisation and alumni sponsors can share an exam by link.",
  QB_MOCK_LINK_INVALID: "Check the number of places (1 to 1,000) and the closing date (within a year).", QB_MOCK_LINK_NOT_FOUND: "That link does not exist. Check it with the person who sent it.",
  QB_MOCK_LINK_CLOSED: "This link is closed.", QB_MOCK_LINK_FULL: "All the places on this link have been taken.", QB_MOCK_OWN_EXAM: "This is your own exam link.",
  QB_MOCK_JOIN_NOT_ALLOWED: "This account cannot join a shared exam. Ask the person who looks after you to give it to you instead.",
  QB_INSUFFICIENT_BALANCE: "You do not have enough Coins yet. Buy Coins first.",
};
const DETAIL_CODES = new Set(["QB_TOPIC_SHORT", "QB_MOCK_OVER_ALLOCATED", "QB_MOCK_VERSION_STALE", "QB_MOCK_QUESTION_INVALID"]);
// Turns a database error into words. Codes that carry a useful detail ("Fractions has 3 available, 5 needed") keep it; nothing else from the database is shown.
export function mockMessage(raw: string | null | undefined): string {
  const text = String(raw ?? ""), code = /(QB_[A-Z_]+)/.exec(text)?.[1] ?? "";
  if (code === "QB_MOCK_NOT_READY") { const first = /QB_MOCK_NOT_READY:\s*([A-Z_]+)/.exec(text)?.[1]; return `${MESSAGES[code]}${first ? ` (${first.toLowerCase().replaceAll("_", " ")})` : ""}`; }
  const base = MESSAGES[code];
  if (!base) return "That did not work. Please try again.";
  const detail = DETAIL_CODES.has(code) ? new RegExp(`${code}:\\s*([^\\n]{3,200})`).exec(text)?.[1]?.trim() : undefined;
  return detail ? `${base} ${detail.replace(/\.$/, "")}.` : base;
}
