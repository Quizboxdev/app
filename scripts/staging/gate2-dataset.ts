// Deterministic School dataset for the Gate 2 hosted smoke test, plus the values qb_school('performance') must return for it.
// Pure data: no network. Used by gate2-seed.ts to build rows and (next run) by the smoke test to assert results.
import { createHash } from "node:crypto";

export const MARK = "GATE2";
// Stable UUIDs so the seed is idempotent and cleanup can find every row it created.
export const gid = (name: string) => { const h = createHash("sha1").update(`${MARK}:${name}`).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
export const email = (name: string) => `gate2-${name}@gate2.invalid`;

export const SCHOOLS = { A: { id: gid("school-a"), name: `${MARK} School A` }, B: { id: gid("school-b"), name: `${MARK} School B` } };

// Identities. Passwords are generated at seed time and kept only in .env.gate2.local.
type U = { role: string; name: string; school?: "A" | "B" | null; institutionRole?: string | null };
const USERS_RAW = {
  adminA: { role: "admin", name: "Gate2 Admin A", school: "A", institutionRole: "admin" },
  adminB: { role: "admin", name: "Gate2 Admin B", school: "B", institutionRole: "admin" },
  teacherA: { role: "teacher", name: "Gate2 Teacher A", school: "A", institutionRole: "teacher" }, // authenticated non-admin
  outsider: { role: "student", name: "Gate2 Outsider", school: null, institutionRole: null }, // authenticated, no school at all
  l1: { role: "student", name: "Gate2 Learner 1" }, l2: { role: "student", name: "Gate2 Learner 2" }, l3: { role: "student", name: "Gate2 Learner 3" },
  l4: { role: "student", name: "Gate2 Learner 4" }, l5: { role: "student", name: "Gate2 Learner 5" }, l6: { role: "student", name: "Gate2 Learner 6" },
  b1: { role: "student", name: "Gate2 Learner B1" },
} as const;
export type UserKey = keyof typeof USERS_RAW;
export const USERS: Record<UserKey, U> = USERS_RAW;

// School A: 7A (B7: L1,L2,L3), 8A (B8: L4), 8B (B8: L5,L6 never assessed). School B: 9B (B9: B1, scored 100 as a leak canary).
export const CLASSES = {
  c7a: { school: "A", name: "G2 7A", grade: "B7", learners: ["l1", "l2", "l3"] as UserKey[], teacher: "teacherA" as UserKey },
  c8a: { school: "A", name: "G2 8A", grade: "B8", learners: ["l4"] as UserKey[], teacher: "teacherA" as UserKey },
  c8b: { school: "A", name: "G2 8B", grade: "B8", learners: ["l5", "l6"] as UserKey[], teacher: "teacherA" as UserKey },
  c9b: { school: "B", name: "G2 9B", grade: "B9", learners: ["b1"] as UserKey[], teacher: "adminB" as UserKey },
} as const;
export type ClassKey = keyof typeof CLASSES;

// Final/draft results. daysAgo orders "latest": l1 has an older 80 and a newer 60, so the learner-level value is 60.
export const GRADES: Array<{ cls: ClassKey; learner: UserKey; asg: AsgKey; pct: number; status: "final" | "draft"; daysAgo: number }> = [
  { cls: "c7a", learner: "l1", asg: "mathDue", pct: 80, status: "final", daysAgo: 10 },
  { cls: "c7a", learner: "l1", asg: "mathDue", pct: 60, status: "final", daysAgo: 2 },
  { cls: "c7a", learner: "l2", asg: "mathDue", pct: 40, status: "final", daysAgo: 3 },
  { cls: "c8a", learner: "l4", asg: "sciOpen", pct: 90, status: "final", daysAgo: 1 },
  { cls: "c8a", learner: "l4", asg: "sciOpen", pct: 10, status: "draft", daysAgo: 0 }, // drafts never count
  { cls: "c9b", learner: "b1", asg: "bAsg", pct: 100, status: "final", daysAgo: 1 }, // must never appear for School A
];

export type AsgKey = "mathDue" | "sciOpen" | "bAsg";
export const ASSIGNMENTS = {
  mathDue: { cls: "c7a" as ClassKey, title: "G2 Fractions (past due)", subject: ["MATH", "Mathematics"], dueDays: -1, targets: ["l1", "l2", "l3"] as UserKey[] },
  sciOpen: { cls: "c8a" as ClassKey, title: "G2 Matter (not yet due)", subject: ["SCI", "Science"], dueDays: 3, targets: ["l4"] as UserKey[] },
  bAsg: { cls: "c9b" as ClassKey, title: "G2 B assignment", subject: ["MATH", "Mathematics"], dueDays: -1, targets: ["b1"] as UserKey[] },
};

// Learning evidence (School A only). X: one learner, 6 responses (4 correct) -> kept but low_evidence. Y: 5 learners x 4 responses (8 correct) -> not low evidence.
// Z: 3 responses -> below the 5-response floor, omitted.
export const EVIDENCE = {
  x: { learners: ["l1"] as UserKey[], perLearner: 6, correct: 4 },
  y: { learners: ["l1", "l2", "l3", "l4", "l5"] as UserKey[], perLearner: 4, correct: 8 }, // 8 correct in total
  z: { learners: ["l1"] as UserKey[], perLearner: 3, correct: 0 },
};

// What qb_school('performance') must return for School A (and nothing from School B).
export const EXPECTED = {
  summary: { learner_count: 6, assessed_learner_count: 3, average_score: 63.3, assignment_completion_rate: 66.7, due_target_count: 3, active_assignment_count: 1 },
  by_class: { "G2 7A": { learner_count: 3, assessed_count: 2, average_score: 50, completion_rate: 66.7 }, "G2 8A": { learner_count: 1, assessed_count: 1, average_score: 90, completion_rate: 100 }, "G2 8B": { learner_count: 2, assessed_count: 0, average_score: null, completion_rate: 0 } },
  by_grade: { B7: { learner_count: 3, assessed_count: 2, average_score: 50 }, B8: { learner_count: 3, assessed_count: 1, average_score: 90 } },
  by_subject: { Mathematics: { assessed_count: 2, average_score: 50 }, Science: { assessed_count: 1, average_score: 90 } },
  weak_indicators: { x: { response_count: 6, assessed_count: 1, average_score: 66.7, low_evidence: true }, y: { response_count: 20, assessed_count: 5, average_score: 40, low_evidence: false }, zOmitted: true },
  neverContains: ["G2 9B", "Gate2 Learner B1", "B9"],
};
