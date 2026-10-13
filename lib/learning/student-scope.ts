// A learner's own place in the curriculum: the grade they registered for decides what Learn shows. The curriculum tree itself is public
// reference data, so this scopes the view; it is never used to widen access.
const LEGACY: Record<string, string> = { B10: "SHS1" };

// Every spelling a grade has been stored under ("SHS 1", "shs1", "B10" for SHS 1), as the codes the curriculum nodes carry.
export function gradeVariants(grade: unknown): string[] {
  const raw = String(grade ?? "").trim();
  if (!raw) return [];
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  const canonical = LEGACY[compact] ?? compact;
  const spaced = canonical.replace(/^(SHS)(\d)$/, "$1 $2");
  return [...new Set([canonical, compact, spaced, raw, raw.toUpperCase()])];
}

// The learner's grade code from their student profile (multi-market grade_code first, then the legacy grade column).
export const studentGrade = (profile: Record<string, unknown> | null | undefined): string =>
  String(profile?.grade_code || profile?.grade || "").trim();
