// Shapes of what the teacher API returns, so the dashboard and other teacher screens are checked by the compiler instead of using `any`.
// The database client is not generated from the schema, so rows are described here, once, and cast at the API boundary (lib/api/teacher.ts).
import type { AssignmentRow, ClassAnalytics, IndicatorAnalytics } from "@/lib/learning/analytics";

export type TeacherClass = { id: string; class_name?: string | null; [column: string]: unknown };
export type TeacherAssignment = AssignmentRow & { id: string; subject_code?: string | null };
export type QuestionBankRow = { id: string; [column: string]: unknown };
export type GradebookRow = { id: string; student_name?: string | null; student_email?: string | null; status?: string | null; percentage?: number | string | null; [column: string]: unknown };

export type TeacherDashboardData = {
  classes: TeacherClass[];
  assignments: TeacherAssignment[];
  questionBanks: QuestionBankRow[];
  gradebook: GradebookRow[];
};

export type ClassWithAnalytics = { id: string; class_name: string } & ClassAnalytics;
// A weak indicator in one class: the numbers plus where to find its learners.
export type NeedsAttentionRow = IndicatorAnalytics & { className: string; classId?: string; curriculumNodeId?: string };
export type TeacherAnalytics = { classes: ClassWithAnalytics[]; indicators: IndicatorAnalytics[]; needsAttention: NeedsAttentionRow[] };

export type IndicatorLearner = {
  student_user_id: string;
  student_name?: string | null;
  student_email?: string | null;
  latestScore?: number | string | null;
  masteryScore?: number | string | null;
  proficiencyState?: string | null;
};
export type IndicatorLearnersPage = { rows: IndicatorLearner[]; total: number };
