import type { QaFixture, QaRoute } from "../fixture-server";
import { DAY, baseTables, curriculumFixture, profileRow, shellRpc, uid } from "./common";

// Student fixture. Scenarios on purpose:
//  weak subject (Mathematics 48%), mastered subject (Science, strong evidence), thin-evidence high score (English, 2 topics),
//  assignment due in 2 days + a later one, finished results (completed work), rank + achievements,
//  an unfinished practice attempt, a player question that is unanswered and one answered wrongly (feedback with explanation).
const USER = uid(201), STUDENT = uid(202), CLASS = uid(203), ATTEMPT = uid(901), DONE = uid(902);

export function buildStudentFixture(now = Date.now()) {
  const tree = curriculumFixture();
  const iso = (offset: number) => new Date(now + offset * DAY).toISOString();
  const result = (n: number, subject_code: string, percentage: number, total_marks: number, ago: number) => ({
    id: uid(300 + n), attempt_id: n === 1 ? DONE : uid(310 + n), subject_code, score: Math.round(total_marks * percentage / 100), total_marks, percentage, passed: percentage >= 50, submitted_at: iso(-ago),
  });
  const results = [result(1, "MATH", 70, 10, 1), result(2, "SCI", 92, 10, 3), result(3, "MATH", 52, 10, 5), result(4, "ENG", 95, 2, 7), result(5, "MATH", 45, 10, 9), result(6, "SCI", 90, 10, 12)];
  const practiceSet = (n: number, subject_code: string, subject_name: string, difficulty: string) => ({ id: uid(400 + n), assessment_type: "PRACTICE", title: `${subject_name} practice`, subject_code, subject_name, grade: "B7", question_count: 10, difficulty, time_limit_minutes: 15 });
  const assignment = (n: number, title: string, due: number) => ({
    id: uid(420 + n), student_id: STUDENT, assignment_id: uid(430 + n), class_id: CLASS, created_at: iso(-2),
    assignments: { id: uid(430 + n), assessment_id: uid(440 + n), title, subject_code: "MATH", due_at: iso(due), mode: "ASSESSMENT", status: "published" },
  });
  const questions = [
    { question_id: uid(601), question_order: 1, question_text: "Which fraction is equivalent to 2/4?", answer_type: "SINGLE_CHOICE", marks: 1, option_a: "1/3", option_b: "3/4", option_c: "1/2", option_d: "2/3" },
    { question_id: uid(602), question_order: 2, question_text: "What is 1/4 + 1/2?", answer_type: "SINGLE_CHOICE", marks: 1, option_a: "2/6", option_b: "3/4", option_c: "1/6", option_d: "2/4" },
    { question_id: uid(603), question_order: 3, question_text: "Which is the largest fraction?", answer_type: "SINGLE_CHOICE", marks: 1, option_a: "1/8", option_b: "3/8", option_c: "5/8", option_d: "1/2" },
  ];
  const correct: Record<string, string> = { [questions[0].question_id]: "C", [questions[1].question_id]: "B", [questions[2].question_id]: "C" };
  const profile = profileRow(USER, "STUDENT", "Akosua Frimpong");
  const attemptRoute = (label: string, steps: QaRoute["steps"] = []): QaRoute => ({ path: `/student/attempt/${ATTEMPT}`, label, steps });

  return {
    role: "student", user: { id: USER, email: profile.email },
    routes: [
      { path: "/student", label: "home" }, { path: "/learn", label: "learn" },
      { path: "/learn", label: "learn-indicator", steps: ["Junior High School", "B7", "Mathematics", "Number", "Fractions", "Add and subtract fractions", "Add fractions with unlike denominators"].map((clickText) => ({ clickText })) },
      { path: "/practise", label: "practise" },
      attemptRoute("player"),
      attemptRoute("player-feedback", [{ click: ".qb-option" }, { clickText: "Check answer" }, { wait: 500 }]),
      { path: `/student/results/${DONE}`, label: "result" }, { path: "/student/results", label: "progress" },
    ],
    tables: {
      ...baseTables(), profiles: [profile], student_profiles: [{ id: STUDENT, user_id: USER, grade: "B7" }],
      curricula: [tree.curriculum], curriculum_nodes: tree.nodes,
      class_memberships: [{ id: uid(204), student_id: STUDENT, class_id: CLASS, joined_at: iso(-60), status: "active", classes: { id: CLASS, class_name: "B7 Gold", grade: "B7" } }],
      assignment_targets: [assignment(1, "Fractions practice", 2), assignment(2, "Integrated Science: Matter", 9)],
      notifications: [],
      learning_events: [
        ...Array.from({ length: 6 }, (_, i) => ({ attempt_id: DONE, is_correct: i < 5, curriculum_node_id: tree.ids.indicator, curriculum_nodes: { code: "B7.1.1.1.1", title: "Add fractions with unlike denominators" } })),
        ...Array.from({ length: 4 }, (_, i) => ({ attempt_id: DONE, is_correct: i < 1, curriculum_node_id: uid(514), curriculum_nodes: { code: "B7.1.1.1.2", title: "Subtract fractions with unlike denominators" } })),
      ],
      xp_transactions: [{ attempt_id: DONE, points: 35, reason: "practice" }],
    },
    rpc: {
      ...shellRpc({ role: "student" }),
      qb_my_results: () => results,
      qb_my_results_page: () => ({ rows: results, total: results.length }),
      qb_my_attempts_page: () => ({ rows: [{ id: ATTEMPT, status: "IN_PROGRESS", assessment_id: uid(401), started_at: iso(-0.1) }], total: 1 }),
      qb_student_xp: () => ({ total_xp: 1240, level: 5, current_level_xp: 40, next_level_xp: 100 }),
      qb_student_competition_analytics: () => ({ current_rank: 12, leaderboard: [{ id: "a", name: "Kwesi Adjei", score: 940 }, { id: "b", name: "Esi Quartey", score: 905 }, { id: "c", name: "Akosua Frimpong", score: 870 }] }),
      qb_student_achievements: () => [{ id: "m1", type: "mastery", tier: "gold", title: "Science Master" }, { id: "m2", type: "mastery", tier: "silver", title: "Ten practice sets" }, { id: "c1", type: "championship", tier: "bronze", title: "Class challenge finalist" }],
      qb_list_available_assessments: () => [practiceSet(1, "MATH", "Mathematics", "medium"), practiceSet(2, "SCI", "Integrated Science", "easy"), practiceSet(3, "ENG", "English", "hard"), { ...practiceSet(4, "MATH", "Mathematics", "mixed"), assessment_type: "ASSESSMENT" }],
      qb_student_insights: () => ({
        by_subject: [{ subject: "Mathematics", mastery: 48, topics: 6 }, { subject: "Integrated Science", mastery: 91, topics: 12 }, { subject: "English", mastery: 88, topics: 2 }],
        weak_topics: [{ topic: "Fractions", mastery: 41 }, { topic: "Ratios", mastery: 55 }], recent_improvement: 4, history: [],
      }),
      qb_question_availability: ({ p_curriculum_node_ids }: any) => tree.availability(p_curriculum_node_ids),
      qb_attempt_mode: () => "PRACTICE",
      qb_get_attempt: () => ({ status: "ok", attempt_id: ATTEMPT, assessment_id: uid(401), attempt_status: "IN_PROGRESS", started_at: iso(-0.01), expires_at: iso(0.02), remaining_seconds: 1500, questions, saved_responses: [] }),
      qb_save_response: () => ({ ok: true }),
      qb_save_practice_response: ({ p_question_id, p_selected_answer }: any) => ({
        question_id: p_question_id, is_correct: p_selected_answer === correct[p_question_id], selected_answer: p_selected_answer, selected_value: null, correct_answer: correct[p_question_id],
        explanation: "2/4 simplifies to 1/2 because both numerator and denominator divide by 2.", hint: "Divide the top and bottom by the same number.", marks_awarded: p_selected_answer === correct[p_question_id] ? 1 : 0,
      }),
      qb_get_result: () => ({ assessment_id: uid(401), percentage: 70, score: 7, total_marks: 10, passed: true, correct_count: 7, incorrect_count: 2, unanswered_count: 1 }),
      qb_get_attempt_review: () => ({
        assessment_id: uid(401), result: { assessment_id: uid(401), percentage: 70, score: 7, total_marks: 10, passed: true, correct_count: 7, incorrect_count: 2, unanswered_count: 1 },
        questions: [
          { ...questions[0], selected_answer: "C", is_correct: true, correct_answer: "C" },
          { ...questions[1], selected_answer: "A", is_correct: false, correct_answer: "B" },
          { ...questions[2], selected_answer: null, is_correct: false, correct_answer: "C" },
        ],
      }),
    },
  } satisfies QaFixture;
}
