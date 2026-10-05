import type { QaFixture, QaRoute, QaStep } from "../fixture-server";
import { DAY, baseTables, curriculumFixture, profileRow, shellRpc, uid } from "./common";

// Teacher fixture. Scenarios on purpose:
//  attention queue (assignment due in 2 days, low completion in B7 Blue, two weak indicators), class performance across bands
//  (B7 Gold proficient, B7 Blue developing, B8 Red emerging), assignments in every phase (active, scheduled, draft, closed),
//  a 30-question bank over two pages with mixed status/difficulty/type, and the five-step assignment builder.
const USER = uid(701), TEACHER = uid(702);
const [GOLD, BLUE, RED] = [uid(711), uid(712), uid(713)];

export function buildTeacherFixture(now = Date.now()) {
  const tree = curriculumFixture();
  const iso = (offset: number) => new Date(now + offset * DAY).toISOString();
  const cls = (id: string, class_name: string, grade: string, subject: boolean) => ({
    id, class_name, grade, grade_code: grade, academic_year: "2026", term: "1", status: "active", join_code: `QB${grade.slice(1)}-${class_name.replace(/\W/g, "").toUpperCase().padEnd(8, "X").slice(0, 8)}`,
    curriculum_id: tree.ids.curriculumId, primary_teacher_id: TEACHER, teacher_id: TEACHER, teacher_user_id: USER, created_at: iso(-90),
    subject_node_id: subject ? tree.ids.mathSubject : null, curriculum_nodes: subject ? { id: tree.ids.mathSubject, title: "Mathematics", subject_code: "MATH" } : null,
  });
  const classes = [cls(GOLD, "B7 Gold", "B7", true), cls(BLUE, "B7 Blue", "B7", true), cls(RED, "B8 Red", "B8", true)];
  const assignment = (n: number, classId: string, title: string, status: string, extra: Record<string, unknown>) => ({
    id: uid(720 + n), class_id: classId, title, status, subject_code: "MATH", mode: "ASSESSMENT", question_count: 10, teacher_id: TEACHER, teacher_user_id: USER, created_at: iso(-10 + n),
    classes: { class_name: classes.find((c) => c.id === classId)!.class_name }, ...extra,
  });
  const assignments = [
    assignment(1, BLUE, "Fractions: unlike denominators", "published", { start_at: iso(-5), due_at: iso(2) }),
    assignment(2, GOLD, "Ratio and proportion", "published", { start_at: iso(-2), due_at: iso(9) }),
    assignment(3, RED, "Algebra warm-up", "published", { start_at: iso(5), due_at: iso(12) }),
    assignment(4, GOLD, "Decimals revision (draft)", "draft", { due_at: null }),
    assignment(5, BLUE, "Number patterns", "published", { start_at: iso(-20), due_at: iso(-6) }),
  ];

  // Learner results per class: Gold is strong with good coverage, Blue is mid with low coverage, Red is weak.
  const roster = (classId: string, size: number) => Array.from({ length: size }, (_, i) => ({ class_id: classId, student_user_id: uid(Number(classId.slice(-3)) * 100 + i), status: "active" }));
  const grades = (classId: string, size: number, assessed: number, base: number) => roster(classId, size).slice(0, assessed).map((m, i) => ({ id: `${classId}-${i}`, class_id: classId, student_user_id: m.student_user_id, percentage: Math.max(5, Math.min(100, base + ((i * 7) % 21) - 10)), status: "final", graded_at: iso(-i), student_name: `Learner ${i + 1}`, student_email: null }));
  const rosters = [...roster(GOLD, 24), ...roster(BLUE, 20), ...roster(RED, 18)];
  const gradebook = [...grades(GOLD, 24, 20, 74), ...grades(BLUE, 20, 8, 50), ...grades(RED, 18, 12, 33)];

  const indicator = (code: string, title: string, classId: string, learners: number, mastery: number, accuracy: number) => ({ code, title, class_id: classId, curriculum_node_id: tree.ids.indicator, learner_count: learners, attempt_count: learners * 4, average_mastery: mastery, average_accuracy: accuracy, proficiency_state: null });
  const bank = Array.from({ length: 30 }, (_, i) => ({
    id: uid(800 + i), question_code: `GH-B7-MATH-${String(i + 1).padStart(4, "0")}`, question_text: ["What is 3/4 + 1/8?", "Simplify 12/18.", "Which is greater: 5/6 or 7/9?", "Write 0.35 as a fraction.", "Find 2/3 of 24."][i % 5] + (i > 4 ? ` (set ${Math.floor(i / 5) + 1})` : ""),
    grade: "B7", canonical_grade_code: "B7", subject_code: "MATH", strand_name: "Number", substrand_name: "Fractions", content_standard_code: "B7.1.1.1", indicator_code: i % 2 ? "B7.1.1.1.2" : "B7.1.1.1.1",
    difficulty_label: ["easy", "medium", "hard"][i % 3], answer_type: ["SINGLE_CHOICE", "NUMERIC", "FRACTION"][i % 3], status: i % 7 === 6 ? "draft" : "active", validation_status: i % 7 === 6 ? "draft" : "approved",
    curriculum_node_id: i % 2 ? uid(514) : tree.ids.indicator, created_at: iso(-i),
  }));
  const profile = profileRow(USER, "TEACHER", "Ama Mensah");
  const builder = (label: string, steps: QaStep[]): QaRoute => ({ path: "/teacher/assignments", label, steps });
  const pickClass: QaStep[] = [{ select: "#asg-class", value: GOLD }, { clickText: "Next step" }];
  const pickObjective: QaStep[] = ["Number", "Fractions", "Add and subtract fractions", "Add fractions with unlike denominators", "Use this objective", "Next step"].map((clickText) => ({ clickText }));

  return {
    role: "teacher", user: { id: USER, email: profile.email },
    routes: [
      { path: "/teacher", label: "home" }, { path: "/teacher/question-banks", label: "question-bank" },
      { path: "/teacher/question-banks", label: "question-bank-scoped", steps: ["Junior High School", "B7", "Mathematics"].map((clickText) => ({ clickText })) },
      builder("builder-class", []), builder("builder-scope", pickClass), builder("builder-questions", [...pickClass, ...pickObjective]),
      builder("builder-review", [...pickClass, ...pickObjective, { clickText: "Next step" }, { fill: "#asg-title", value: "Fractions practice" }, { clickText: "Next step" }]),
    ],
    tables: {
      ...baseTables(), profiles: [profile], teacher_profiles: [{ id: TEACHER, user_id: USER }],
      classes, assignments, question_banks: [], gradebook, class_memberships: rosters,
      curricula: [tree.curriculum], curriculum_nodes: tree.nodes, questions: bank,
    },
    rpc: {
      ...shellRpc({ role: "teacher" }),
      qb_teacher_indicator_summary: () => [
        indicator("B7.1.1.1.2", "Subtract fractions with unlike denominators", BLUE, 14, 41, 38),
        indicator("B7.1.1.1.1", "Add fractions with unlike denominators", GOLD, 18, 62, 66),
        indicator("B7.2.1.1.1", "Describe properties of metals", GOLD, 20, 86, 91),
      ],
      qb_question_availability: ({ p_curriculum_node_ids }: any) => tree.availability(p_curriculum_node_ids),
      qb_home: () => ({ role: "teacher", market: "Ghana", locale: "en-GH", currency: "GHS", sections: [
        { key: "summary", title: "Teaching summary", kind: "stats", stats: [{ label: "Classes", value: 3 }, { label: "Learners", value: 62 }, { label: "Open assignments", value: 3 }] },
        { key: "pending", title: "Marking and follow-up", kind: "list", items: [{ title: "7 submissions to review", subtitle: "B7 Blue", href: "/teacher/gradebook" }, { title: "Remedial practice suggested", subtitle: "Subtract fractions", href: "/teacher" }] },
      ] }),
      qb_teacher_insights: () => ({
        assignment_completion: [{ assignment: "Fractions: unlike denominators", class: "B7 Blue", submitted: 8, targets: 20, due_at: iso(2) }, { assignment: "Number patterns", class: "B7 Blue", submitted: 17, targets: 20, due_at: iso(-6) }],
        student_progress: [{ student: "Learner 1", results: 4, average: 78, last: 81 }, { student: "Learner 2", results: 3, average: 41, last: 35 }],
        question_difficulty: [{ question: "Subtract 3/5 from 7/8", responses: 40, accuracy: 28 }],
      }),
    },
  } satisfies QaFixture;
}
