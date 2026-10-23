// How guides are grouped. The order here is the order on the Help pages.
export const HELP_CATEGORIES = [
  { id: "getting-started", label: "Getting started" },
  { id: "practise", label: "Practice and results" },
  { id: "classes", label: "Classes" },
  { id: "assignments", label: "Assignments" },
  { id: "challenges", label: "Challenges and competitions" },
  { id: "payments", label: "Payments and refunds" },
  { id: "account", label: "Your account and support" },
  { id: "safety", label: "Safety and privacy" },
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number]["id"];
export const HELP_AUDIENCES = [{ id: "everyone", label: "Everyone" }, { id: "student", label: "Learners" }, { id: "teacher", label: "Teachers" }, { id: "school", label: "Schools" }, { id: "sponsor", label: "Sponsors" }] as const;
export type HelpMeta = { slug: string; title: string; summary: string; category: HelpCategory; audiences: string[]; views?: number };
export type HelpArticle = { slug: string; title: string; summary: string; body: string; category: HelpCategory; audiences: string[]; updated_at: string };
export type HelpDetail = { article: HelpArticle; related: { slug: string; title: string; summary: string }[] };
export const categoryLabel = (id: string) => HELP_CATEGORIES.find((c) => c.id === id)?.label ?? id;
// A signed-in person's role decides which guides come first.
export const audienceForRole = (role: string | null | undefined): "student" | "teacher" | "school" | "sponsor" | null => {
  const r = String(role ?? "").toUpperCase();
  return r === "STUDENT" ? "student" : r === "TEACHER" ? "teacher" : r === "SPONSOR" ? "sponsor" : r === "SCHOOL_ADMIN" || r === "INSTITUTION_ADMIN" ? "school" : null;
};

// The page already shows a guide's title as its heading, so the guide's own first "# Title" line is left out of the steps.
export const withoutTitleLine = (body: string) => body.replace(/^#[ \t]+[^\n]*\n+/, "");
