// Shapes of what the student API returns, so the student home and related screens are checked by the compiler instead of using `any`.
// The database client is not generated from the schema, so rows are described here, once, and cast at the API boundary (lib/api/student.ts).
export type StudentResult = {
  submitted_at?: string | null;
  percentage?: number | string | null;
  total_marks?: number | string | null;
  subject_code?: string | null;
  [column: string]: unknown;
};

export type StudentAssignmentTarget = {
  id?: string | number;
  assignment_id: string;
  class_id?: string | null;
  assignments?: { assessment_id?: string; title?: string | null; due_at?: string | null; subject_code?: string | null; mode?: string | null } | null;
  [column: string]: unknown;
};

export type StudentMembership = { classes?: { grade?: string | null; [column: string]: unknown } | null; [column: string]: unknown };
export type StudentXp = { total_xp: number | string; level: number | string; current_level_xp: number | string; next_level_xp: number | string };

export type StudentDashboardData = {
  results: StudentResult[];
  memberships: StudentMembership[];
  assignments: StudentAssignmentTarget[];
  notifications: Record<string, unknown>[];
  xp: StudentXp;
  stats: { completed: number; average: number; best: number };
};

export type LeaderboardEntry = { id?: string | number; name?: string | null; score?: number | string | null };
export type CompetitionAnalytics = { current_rank?: number | null; leaderboard?: LeaderboardEntry[] | null; [column: string]: unknown };
export type Achievement = { id: string | number; type?: string | null; tier?: string | null; title?: string | null };

export type AvailableAssessment = {
  id: string;
  assessment_type?: string | null;
  title?: string | null;
  subject_name?: string | null;
  subject_code?: string | null;
  question_count?: number | null;
  time_limit_minutes?: number | null;
  grade?: string | null;
  difficulty?: string | null;
  [column: string]: unknown;
};
export type MyAttempt = { id: string; status?: string | null; assessment_id?: string | null; [column: string]: unknown };
// What qb_student_insights returns for the practise screen: per-subject mastery (more fields exist; only these are read here).
export type StudentInsights = { by_subject?: Array<{ subject?: string | null; mastery?: number | string | null }>; [column: string]: unknown };
export type StartedAttempt = { attempt_id: string; [column: string]: unknown };
