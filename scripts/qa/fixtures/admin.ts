import type { QaFixture } from "../fixture-server";
import { DAY, baseTables, profileRow, shellRpc, uid } from "./common";

// Minimal fixture used to visually regression-check shared CSS on the Admin home and the Competitions list.
// It is not an Admin phase fixture: it only feeds the pages' existing reads.
const USER = uid(901);

export function buildAdminFixture(now = Date.now()) {
  const iso = (offset: number) => new Date(now + offset * DAY).toISOString();
  const profile = profileRow(USER, "ADMIN", "Kojo Admin");
  const competition = (n: number, title: string, competition_type: string, subject_code: string, grade: string) => ({
    id: uid(950 + n), title, competition_type, subject_code, grade, description: "Open to all enrolled learners in the market. Top scorers are recognised on the leaderboard.", starts_at: iso(-n * 7),
  });
  return {
    role: "admin", user: { id: USER, email: profile.email },
    routes: [{ path: "/admin", label: "admin-home" }, { path: "/competition", label: "competitions" }],
    tables: { ...baseTables(), profiles: [profile], competitions: [competition(1, "Term 1 Maths Challenge", "INDIVIDUAL", "MATH", "B7"), competition(2, "Inter-school Science Cup", "SCHOOL", "SCI", "B8"), competition(3, "Team Quiz Relay", "TEAM", "ENG", "B9")] },
    rpc: {
      ...shellRpc({ role: "platform_admin" }),
      qb_admin_platform_overview: () => ({ users: { total: 1284, by_role: { STUDENT: 1010, TEACHER: 190, SCHOOL_ADMIN: 62, SPONSOR: 22 }, by_market: { Ghana: 1190, Nigeria: 94 } }, markets: { active: 2, configuring: 1 }, content: { questions: 5400 }, competitions: { competitions: 3 } }),
      qb_admin_content_health: () => ({ approved_questions: 5120, generation_throughput: 340, sme_review_throughput: 210, source_coverage: 78 }),
      qb_admin_competition_metrics: () => ({ total_competitions: 3 }),
      qb_admin_operations_health: () => ({ unresolved_source_issues: 4, unresolved_compensation: 0 }),
    },
  } satisfies QaFixture;
}
