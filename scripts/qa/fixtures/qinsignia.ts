import type { QaFixture } from "../fixture-server";
import { buildStudentFixture } from "./student";
import { uid } from "./common";

// Q-Insignia Knowledge Window v0.2 pilot: the student fixture with the pilot flags on and the practice menu / access calls the
// subject cards read. QI_SCENARIO picks the data case (all fixture data, nothing hosted):
//   default    returning learner: results in 3 subjects, one IN_PROGRESS attempt, 2 free sessions left; subjects with and
//              without photos, a long subject name, a subject the curriculum spells differently from the logo slug
//   exhausted  free allowance used (account-wide): one page-level status, no per-subject locks
//   newlearner no results and no attempts
//   empty      practice menu has no subjects for the grade
//   zero       a subject listed with 0 available questions (defensive state: the live RPC omits such subjects)
//   flagoff    pilot flag off: the existing subject UI must render unchanged
//   noconcept  cards on, concept photos not allowed (production default until assets are approved): letter-tile fallbacks
export function buildQinsigniaFixture(now = Date.now()): QaFixture {
  const scenario = process.env.QI_SCENARIO ?? "default";
  const base = buildStudentFixture(now);
  const flag = (key: string, value: boolean) => ({ key: `flags.${key}`, value, scope_type: "global", scope_id: null });
  const subject = (n: number, name: string, code: string, topics: string[], per = 12) => ({
    id: uid(600 + n), name, subject_code: code, available: topics.length * per,
    topics: topics.map((title, i) => ({ id: uid(600 + n * 10 + i + 100), title, strand: "Strand", available: per })),
  });
  let subjects = [
    subject(1, "Mathematics", "MATH", ["Fractions", "Ratios", "Algebraic expressions", "Geometry"]),
    subject(2, "Integrated Science", "SCI", ["Materials", "Life cycles", "Energy"]),
    subject(3, "English", "ENG", ["Reading comprehension", "Grammar"]),
    subject(4, "Computing", "COMP", ["Spreadsheets", "Algorithms"]),
    subject(5, "Religious and Moral Education", "RME", ["Festivals", "Moral values"]),
    subject(6, "Creative Arts and Design", "CAD", ["Drawing", "Craft"]),
    subject(7, "Social Studies", "SOC", ["Our environment", "Governance"]),
    subject(8, "Ghanaian Language and Culture (Asante Twi)", "GHL", ["Oral literature"]),
  ];
  if (scenario === "empty") subjects = [];
  if (scenario === "zero") subjects = [...subjects.slice(0, 3), { ...subject(9, "French", "FRE", ["Greetings"]), available: 0, topics: [] }];
  const access = scenario === "exhausted"
    ? { gated: true, free_limit: 3, used: 3, remaining: 0, subscribed: false, exhausted: true }
    : { gated: true, free_limit: 3, used: 1, remaining: 2, subscribed: false, exhausted: false };
  const newLearner = scenario === "newlearner";
  return {
    ...base,
    routes: [{ path: "/student", label: "home" }, { path: "/practise", label: "practise" },
      { path: "/practise", label: "practise-picked", steps: [{ clickText: "Computing" }, { wait: 300 }] },
      { path: `/practise?pick=${uid(601)}`, label: "practise-deeplink" }, { path: "/student/results", label: "progress" }],
    tables: {
      ...base.tables,
      platform_settings: scenario === "flagoff" ? [] : [flag("q_insignia_subject_cards_v02", true), flag("q_insignia_concept_photos", scenario !== "noconcept")],
      ...(newLearner ? { assignment_targets: [] } : {}),
    },
    rpc: {
      ...base.rpc,
      qb_practice_menu: () => ({ grade: "B7", subjects }),
      qb_my_access: () => access,
      qb_topic_progress: () => [],
      ...(newLearner ? {
        qb_my_results: () => [], qb_my_results_page: () => ({ rows: [], total: 0 }), qb_my_attempts_page: () => ({ rows: [], total: 0 }),
        qb_student_insights: () => ({ by_subject: [], weak_topics: [], recent_improvement: null, history: [] }),
        qb_student_xp: () => ({ total_xp: 0, level: 1, current_level_xp: 0, next_level_xp: 100 }),
      } : {}),
    },
  };
}
