import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The attempt review carries each question's explanation for ordinary attempts, and leaves competition attempts to the competition's own visibility rule
// (isolated PostgreSQL; the engine review function is stubbed to return a fixed review, which is all the wrapper reads).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261064100000_attempt_review_explanations.sql");
const ROLLBACK = read("../../supabase/rollback/attempt_review_explanations.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [Q1, Q2, Q3, PRACTICE, COMP_HIDDEN, COMP_SHOWN, SNAP_HIDDEN, SNAP_SHOWN] = [1, 2, 3, 10, 11, 12, 21, 22].map(id);
let db: PGlite;
const review = async (attempt: string) => (await db.query<{ r: any }>("select public.qb_get_attempt_review($1) as r", [attempt])).rows[0].r;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema quizbox_competition;
    create table public.questions(id uuid primary key, explanation text);
    create table quizbox_competition.snapshots(id uuid primary key, payload jsonb);
    create table quizbox_competition.participations(snapshot_id uuid, attempt_id uuid);
    -- Stand-in for the engine review: the same three questions for any attempt, with the correct answer and no explanation (as the real engine returns).
    create function quizbox_competition.engine_attempt_review(p_attempt_id uuid) returns jsonb language sql as $$
      select jsonb_build_object('status','PASS','attempt_id',p_attempt_id,'questions',jsonb_build_array(
        jsonb_build_object('question_order',1,'question_id','${Q1}','question_text','Q one','selected_answer','B','correct_answer','C','is_correct',false),
        jsonb_build_object('question_order',2,'question_id','${Q2}','question_text','Q two','selected_answer','A','correct_answer','A','is_correct',true),
        jsonb_build_object('question_order',3,'question_id','${Q3}','question_text','Q three','selected_answer',null,'correct_answer','D','is_correct',false)))
    $$;
    insert into public.questions values ('${Q1}','Because plants need light.'),('${Q2}','   '),('${Q3}',null);
    insert into quizbox_competition.snapshots values
      ('${SNAP_HIDDEN}', '{"configuration":{"answerVisibility":"after_submission","explanationVisibility":"never"},"questions":[{"question_id":"${Q1}","content":{"explanation":"SECRET competition note"}}]}'),
      ('${SNAP_SHOWN}',  '{"configuration":{"answerVisibility":"after_submission","explanationVisibility":"after_submission"},"questions":[{"question_id":"${Q1}","content":{"explanation":"Competition note"}}]}');
    insert into quizbox_competition.participations values ('${SNAP_HIDDEN}','${COMP_HIDDEN}'),('${SNAP_SHOWN}','${COMP_SHOWN}');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("attempt review explanations", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("adds each question's explanation to an ordinary attempt, empty ones as null, in question order", async () => {
    const r = await review(PRACTICE);
    expect(r.questions.map((q: any) => q.question_id)).toEqual([Q1, Q2, Q3]);
    expect(r.questions.map((q: any) => q.explanation)).toEqual(["Because plants need light.", null, null]);
    expect(r.questions[0]).toMatchObject({ selected_answer: "B", correct_answer: "C", is_correct: false });   // everything else is untouched
    expect(r.status).toBe("PASS");
  });

  it("never shows a competition's explanation unless that competition allows it", async () => {
    const hidden = await review(COMP_HIDDEN);
    expect(JSON.stringify(hidden)).not.toMatch(/SECRET|Because plants/);
    expect(hidden.questions.every((q: any) => !("explanation" in q))).toBe(true);
    const shown = await review(COMP_SHOWN);
    expect(shown.questions[0].explanation).toBe("Competition note");
    expect(JSON.stringify(shown)).not.toMatch(/Because plants/);   // from the competition snapshot, not the live question
  });

  it("the rollback returns ordinary attempts to no explanation", async () => {
    await db.exec(ROLLBACK);
    expect((await review(PRACTICE)).questions.every((q: any) => !("explanation" in q))).toBe(true);
    await db.exec(MIGRATION);
    expect((await review(PRACTICE)).questions[0].explanation).toBe("Because plants need light.");
  });
});
