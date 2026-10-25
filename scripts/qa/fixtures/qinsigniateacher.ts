import type { QaFixture } from "../fixture-server";
import { buildTeacherFixture } from "./teacher";
import { uid } from "./common";

// Q-Insignia Knowledge Window v0.2 pilot, Teacher phase: the teacher fixture with the pilot flags and the data the two Teacher surfaces read
// (Teacher Home "Subjects you teach" from the class list, and the by-topic assignment builder's subject selector from qb_teacher_topics).
// QI_SCENARIO (all fixture data, nothing hosted):
//   default    flags on, concept photos allowed; five subjects with open topics plus one subject whose topics have 0 questions
//   noconcept  cards on, concept photos not allowed (the production default until assets are approved): letter-tile fallbacks
//   flagoff    pilot flag off: the existing <select> and Teacher Home render unchanged
//   notopics   the class has no open topics (empty selector state)
export function buildQinsigniateacherFixture(now = Date.now()): QaFixture {
  const scenario = process.env.QI_SCENARIO ?? "default";
  const base = buildTeacherFixture(now) as unknown as QaFixture & { tables: Record<string, unknown[]>; rpc: Record<string, (a: any) => unknown> };
  const GOLD = uid(711), RED = uid(713), ENG = uid(714);
  const flag = (key: string, value: boolean) => ({ key: `flags.${key}`, value, scope_type: "global", scope_id: null });

  const subjectOf = (title: string, code: string) => ({ subject_node_id: uid(990), curriculum_nodes: { id: uid(990), title, subject_code: code } });
  const classes = (base.tables.classes as any[]).map((c) => c.id === RED ? { ...c, ...subjectOf("Integrated Science", "SCI") } : c);
  classes.push({ ...classes[0], id: ENG, class_name: "B7 English", ...subjectOf("English Language", "ENG") });
  const assignments = [...(base.tables.assignments as any[]),
    { ...(base.tables.assignments as any[])[0], id: uid(790), class_id: ENG, title: "Reading comprehension", classes: { class_name: "B7 English" }, subject_code: "ENG" }];

  const topic = (n: number, subject: string, title: string, available: number) => ({
    topic_id: uid(900 + n), title, subject, grade: "B7", strand: "Strand", sub_strand: null, indicator_code: `IND-${n}`, indicator: title,
    concepts: [], available, easy: Math.floor(available / 3), medium: Math.floor(available / 3), hard: available - 2 * Math.floor(available / 3),
  });
  const topics = scenario === "notopics" ? [] : [
    topic(1, "Mathematics", "Add fractions with unlike denominators", 30), topic(2, "Mathematics", "Ratios and proportion", 24), topic(3, "Mathematics", "Algebraic expressions", 18),
    topic(4, "Integrated Science", "Materials and their properties", 21), topic(5, "Integrated Science", "Life cycles", 15),
    topic(6, "English Language", "Reading comprehension", 27), topic(7, "English Language", "Grammar and usage", 12),
    topic(8, "Computing", "Spreadsheets", 18), topic(9, "Computing", "Algorithms and flowcharts", 9),
    topic(10, "Creative Arts and Design", "Drawing and design", 12),
    topic(11, "Ghanaian Language and Culture (Asante Twi)", "Oral literature", 8),
    topic(12, "French", "Greetings", 0),
  ];

  return {
    ...base,
    routes: [
      { path: "/teacher", label: "home" },
      { path: "/teacher/assignments/by-topic", label: "bytopic-start" },
      { path: "/teacher/assignments/by-topic", label: "bytopic-subjects", steps: [{ select: "#bt-class", value: GOLD }, { wait: 700 }] },
      { path: "/teacher/assignments/by-topic", label: "bytopic-switched", steps: [{ select: "#bt-class", value: GOLD }, { wait: 500 }, { click: "input[type=checkbox]" }, { clickText: "Computing" }, { wait: 500 }] },
    ],
    tables: {
      ...base.tables, classes, assignments,
      platform_settings: scenario === "flagoff" ? [] : [flag("q_insignia_subject_cards_v02", true), flag("q_insignia_concept_photos", scenario !== "noconcept")],
    },
    rpc: {
      ...base.rpc,
      qb_teacher_topics: () => topics,
      qb_topic_assignment_plan: ({ p_topic_ids, p_total }: any) => ({ total: p_total, shares: (p_topic_ids as string[]).map((id, i) => {
        const t = topics.find((x) => x.topic_id === id)!; const share = Math.floor(p_total / p_topic_ids.length) + (i < p_total % p_topic_ids.length ? 1 : 0);
        return { topic_id: id, title: t.title, share, available: t.available, easy: Math.ceil(share / 3), medium: Math.ceil(share / 3), hard: Math.max(0, share - 2 * Math.ceil(share / 3)) };
      }) }),
    },
  };
}
