// Levels a mock exam may draw from. This mirrors quizbox_mock.eligible in migration 20261122100000: the same stage (Primary B1-B6, JHS B7-B9, SHS1-SHS3) and not above the target year.
// The database decides; this only lets the screen show the right choices before asking.
export const GRADES = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "SHS1", "SHS2", "SHS3"] as const;
export type Grade = (typeof GRADES)[number];
export type Stage = "PRIMARY" | "JHS" | "SHS";

export const canonGrade = (g: string | null | undefined): string => { const x = String(g ?? "").trim().toUpperCase(); return x === "B10" ? "SHS1" : x; };
export const gradeRank = (g: string): number | null => { const i = GRADES.indexOf(canonGrade(g) as Grade); return i < 0 ? null : i + 1; };
export function stageOf(g: string): Stage | null {
  const r = gradeRank(g);
  return r === null ? null : r <= 6 ? "PRIMARY" : r <= 9 ? "JHS" : "SHS";
}
export const eligibleGrades = (target: string): Grade[] => GRADES.filter((g) => stageOf(target) !== null && stageOf(g) === stageOf(target) && gradeRank(g)! <= gradeRank(target)!);

const NAMES: Record<string, string> = { B1: "Primary 1", B2: "Primary 2", B3: "Primary 3", B4: "Primary 4", B5: "Primary 5", B6: "Primary 6", B7: "JHS 1", B8: "JHS 2", B9: "JHS 3", SHS1: "SHS 1", SHS2: "SHS 2", SHS3: "SHS 3" };
// "JHS 2 (B8)": the friendly name with the code every other screen uses.
export const gradeLabel = (g: string): string => { const c = canonGrade(g); return NAMES[c] ? `${NAMES[c]} (${c})` : c || "-"; };
export const stageLabel = (s: Stage | string | null): string => (s === "PRIMARY" ? "Primary" : s === "JHS" ? "Junior High" : s === "SHS" ? "Senior High" : "");
