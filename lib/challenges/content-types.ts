// What kind of material an organiser is loading. The type guides the upload screen (what to bring, what good questions look like) and is shown, counted, to everyone.
// `kind` is how the database treats the text for question grounding: a book needs every question to quote its passage.
export const CONTENT_TYPES = [
  { id: "story_book", label: "Story book", kind: "book", plural: "story books", icon: "📖", bring: "A story, novel or reader.", ideas: "Ask about characters, what happened, and the lesson of the story." },
  { id: "faith_book", label: "Faith book", kind: "book", plural: "faith books", icon: "🕊️", bring: "Scripture, a devotional or a faith reader.", ideas: "Ask what a passage says, who said it, and what it teaches." },
  { id: "doctrine", label: "Doctrine and teachings", kind: "article", plural: "doctrine documents", icon: "📜", bring: "Beliefs, a catechism, a creed or the teachings of your organisation.", ideas: "Ask what the organisation believes and how a teaching applies." },
  { id: "corporate", label: "Corporate and training", kind: "article", plural: "corporate documents", icon: "🏢", bring: "A policy, handbook, onboarding or training document.", ideas: "Ask what the policy requires and what to do in a real situation." },
  { id: "marketing", label: "Marketing and product", kind: "article", plural: "marketing documents", icon: "📣", bring: "A product guide, brochure or brand story.", ideas: "Ask what the product does, who it is for, and how it is different." },
  { id: "textbook", label: "Textbook and study notes", kind: "book", plural: "textbooks and notes", icon: "🎓", bring: "Chapters of a textbook or your own study notes.", ideas: "Ask definitions, examples and how a method works." },
  { id: "article", label: "Article or report", kind: "article", plural: "articles", icon: "📰", bring: "A news article, report or paper.", ideas: "Ask the main points, numbers and conclusions." },
  { id: "other", label: "Something else", kind: "notes", plural: "other documents", icon: "📄", bring: "Any other text.", ideas: "Ask about the key facts in the text." },
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number]["id"];
export const contentType = (id: string | null | undefined) => CONTENT_TYPES.find((t) => t.id === id) ?? CONTENT_TYPES[CONTENT_TYPES.length - 1];

// Who a quiz is for, so it can be shown to the right people on QuizBox.
export const TARGET_LEVELS = [
  { id: "PRIMARY", label: "Primary (B1 to B6)" }, { id: "JHS", label: "Junior High (B7 to B9)" }, { id: "SHS", label: "Senior High" }, { id: "ADULT", label: "Adults and staff" },
] as const;
export type TargetLevel = (typeof TARGET_LEVELS)[number]["id"];
// A learner's grade decides which sponsored quizzes they are shown (no match = see everything aimed at everyone).
export function levelFromGrade(grade: string | null | undefined): TargetLevel | undefined {
  const g = String(grade ?? "").toUpperCase().replace(/\s+/g, "");
  const m = /^B(\d+)$/.exec(g);
  if (m) return Number(m[1]) <= 6 ? "PRIMARY" : Number(m[1]) <= 9 ? "JHS" : undefined;
  return /^SHS/.test(g) ? "SHS" : undefined;
}
