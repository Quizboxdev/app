import type { QaFixture } from "../fixture-server";
import { baseTables, shellRpc } from "./common";
import type { SchoolHistoryRow, SchoolOverview, SchoolPerformance } from "../../../lib/api/school";

// Deterministic School fixture. Scenarios covered on purpose:
//  normal classes (B7 Gold/Blue), low average + low coverage (B8 Red), zero-learner class (B8 Green), class with no teacher (B9 Alpha, also thin sample),
//  learners but no results (B9 Beta), teacher with no active class (Yaw Darko), archived class, thin-evidence subject and indicator.
const USER = "00000000-0000-4000-8000-0000000000a1";
const INST = "00000000-0000-4000-8000-0000000000b1";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const staff = { ama: id(11), kofi: id(12), efua: id(13), kwame: id(14), yaw: id(15), head: id(16) };

export function buildSchoolFixture(now = Date.parse("2026-10-05T09:00:00Z")): QaFixture & { overview: SchoolOverview; history: SchoolHistoryRow[]; performance: SchoolPerformance } {
  const overview: SchoolOverview = {
    institution: "Adum Basic School",
    teachers: [
      { user_id: staff.ama, name: "Ama Mensah", role: "teacher" }, { user_id: staff.kofi, name: "Kofi Boateng", role: "teacher" },
      { user_id: staff.efua, name: "Efua Owusu", role: "teacher" }, { user_id: staff.kwame, name: "Kwame Asare", role: "teacher" },
      { user_id: staff.yaw, name: "Yaw Darko", role: "teacher" }, { user_id: staff.head, name: "Abena Sarpong", role: "owner" },
    ],
    classes: [
      { id: id(21), name: "B7 Gold", grade: "B7", status: "active", teacher: "Ama Mensah", teacher_user_id: staff.ama, students: 32 },
      { id: id(22), name: "B7 Blue", grade: "B7", status: "active", teacher: "Kofi Boateng", teacher_user_id: staff.kofi, students: 28 },
      { id: id(23), name: "B8 Red", grade: "B8", status: "active", teacher: "Efua Owusu", teacher_user_id: staff.efua, students: 30 },
      { id: id(24), name: "B8 Green", grade: "B8", status: "active", teacher: "Kwame Asare", teacher_user_id: staff.kwame, students: 0 },
      { id: id(25), name: "B9 Alpha", grade: "B9", status: "active", teacher: null, teacher_user_id: null, students: 25 },
      { id: id(26), name: "B9 Beta", grade: "B9", status: "active", teacher: "Ama Mensah", teacher_user_id: staff.ama, students: 22 },
      { id: id(27), name: "B6 2025", grade: "B6", status: "archived", teacher: "Kofi Boateng", teacher_user_id: staff.kofi, students: 0 },
    ],
    summary: { unique_learners: 137, joined_last_30d: 11 },
  };
  const day = (n: number) => new Date(now - n * 864e5).toISOString();
  const names = ["Akosua Frimpong", "Kwesi Adjei", "Esi Quartey", "Yaw Nkrumah", "Adwoa Tetteh", "Nana Osei", "Efua Baidoo", "Kojo Armah", "Maame Ofori", "Selina Anim", "Kweku Addo", "Abigail Lamptey"];
  const classes = ["B7 Gold", "B7 Blue", "B8 Red", "B9 Alpha", "B9 Beta", "B7 Gold"];
  const history: SchoolHistoryRow[] = names.map((student, i) => ({ class: classes[i % classes.length], student, status: i === 3 ? "inactive" : "active", joined_at: day(2 + i * 3), left_at: i === 3 ? day(1) : null }));
  const cls = (n: number, name: string, grade: string, learners: number, assessed: number, average: number | null, completion: number | null) => ({ class_id: id(n), class_name: name, grade, learner_count: learners, assessed_count: assessed, average_score: average, completion_rate: completion });
  const performance: SchoolPerformance = {
    summary: { learner_count: 137, assessed_learner_count: 62, average_score: 58.8, assignment_completion_rate: 71.4, due_target_count: 140, active_assignment_count: 6 },
    by_grade: [
      { grade: "B7", learner_count: 60, assessed_count: 48, average_score: 64.9, completion_rate: 80 },
      { grade: "B8", learner_count: 30, assessed_count: 12, average_score: 34, completion_rate: 40 },
      { grade: "B9", learner_count: 47, assessed_count: 2, average_score: 61, completion_rate: 4.3 },
    ],
    by_class: [
      cls(21, "B7 Gold", "B7", 32, 28, 72, 87.5), cls(22, "B7 Blue", "B7", 28, 20, 55, 71.4), cls(23, "B8 Red", "B8", 30, 12, 34, 40),
      cls(24, "B8 Green", "B8", 0, 0, null, null), cls(25, "B9 Alpha", "B9", 25, 2, 61, 8), cls(26, "B9 Beta", "B9", 22, 0, null, 0),
    ],
    by_subject: [{ subject: "English", assessed_count: 40, average_score: 66.2 }, { subject: "Mathematics", assessed_count: 52, average_score: 51.7 }, { subject: "Science", assessed_count: 31, average_score: 58 }, { subject: "ICT", assessed_count: 2, average_score: 90 }],
    weak_indicators: [
      { node_id: id(31), code: "B8.1.2.1", label: "Operations on fractions", assessed_count: 14, response_count: 96, average_score: 38.5, low_evidence: false },
      { node_id: id(32), code: "B7.3.1.2", label: "Interpreting bar graphs", assessed_count: 22, response_count: 130, average_score: 55.4, low_evidence: false },
      { node_id: id(33), code: "B9.2.1.1", label: "Properties of matter", assessed_count: 1, response_count: 6, average_score: 33.3, low_evidence: true },
    ],
  };
  const profile = { id: USER, role: "ADMIN", status: "active", full_name: "Abena Sarpong", email: "head@adum.example.invalid", onboarding_completed_at: "2026-01-02T00:00:00Z", country: "Ghana" };
  const members = overview.classes.filter((c) => c.status === "active" && c.students > 0).flatMap((c) => names.slice(0, 3).map((n, i) => ({ id: id(100 + i), class_id: c.id, student_name: n })));
  return {
    role: "school", user: { id: USER, email: profile.email }, overview, history, performance,
    routes: ["/school", "/school/classes", "/school/teachers", "/school/learners", "/school/performance"],
    tables: { ...baseTables(), profiles: [profile], class_memberships: members },
    rpc: {
      qb_school: ({ p_action }: { p_action: string }) => {
        if (p_action === "my_schools") return [{ id: INST, name: overview.institution, role: "owner" }];
        if (p_action === "overview") return overview;
        if (p_action === "history") return history;
        if (p_action === "performance") return performance;
        return {};
      },
      ...shellRpc({ role: "school_owner", institution: { id: INST, name: overview.institution } }),
    },
  };
}
