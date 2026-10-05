import { isUuid } from "@/lib/format";

// Learner-facing labels for raw subject/assessment codes. Dev fixture markers never reach the UI.
export function sanitizeLabel(label: unknown): string {
  if (!label) return "";
  const clean = String(label).replace(/DEV_FACTORY_PILOT|snapshot|dev_|test_|fixture_/gi, "").trim();
  if (!clean) return "General assessment";
  const subjectMap: Record<string, string> = { MATH: "Mathematics", SCI: "Science", ENG: "English", COMP: "Computing" };
  return subjectMap[clean.toUpperCase()] || clean;
}

export const subjectLabel = (code: unknown): string => (!code || isUuid(code) ? "General" : sanitizeLabel(code));

// Practise deep-links carry the subject code; "General" has no code to filter on.
export const practiseHref = (subjectCode?: unknown) => (subjectCode && !isUuid(subjectCode) ? `/practise?subject=${encodeURIComponent(String(subjectCode))}` : "/practise");
