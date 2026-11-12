import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The creator's participants list: attempts per person next to the best score, visible to the owner only (isolated PostgreSQL; foundation and extensions applied first, both unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const FOUNDATION = read("../../supabase/migrations/20261021100000_challenges_foundation.sql");
const EXTENSIONS = read("../../supabase/migrations/20261022100000_challenges_extensions.sql");
const MIGRATION = read("../../supabase/migrations/20261062100000_challenge_participants.sql");
const ROLLBACK = read("../../supabase/rollback/challenge_participants.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, P1, P2, P3, OTHER_TEACHER] = [1, 2, 3, 4, 5, 6].map(id);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const mkq = (n: number) => Array.from({ length: n }, (_, i) => ({ question_text: `Question ${i + 1} text?`, options: ["one", "two", "three", "four"], correct_index: 0, explanation: "because", stage_no: 1 }));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin')), active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.questions(id uuid primary key default gen_random_uuid(), subject_code text, grade text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text, status text default 'active', answer_type text default 'SINGLE_CHOICE');
    insert into public.profiles values ('${OWNER}','OWNER','active','Site Owner','owner@example.com'),('${TEACHER}','TEACHER','active','Efua Mensah','efua@example.com'),('${P1}','STUDENT','active','Kofi Boateng','kofi@example.com'),
      ('${P2}','STUDENT','active','Abena Owusu','abena@example.com'),('${P3}','STUDENT','active','Yaw Darko','yaw@example.com'),('${OTHER_TEACHER}','TEACHER','active','Yaw Asante','ya@example.com');
  `);
  await db.exec(FOUNDATION);
  await db.exec(EXTENSIONS);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("challenge participants (attempts per person)", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("shows the owner each person's attempts and best score, and nobody else", async () => {
    await as(TEACHER);
    const c = await rpc("select public.challenge_create($1,'x','general_knowledge','PUBLIC',3,600,2)", ["Attempts Quiz"]);
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(3))]); await rpc("select public.challenge_publish($1)", [c.id]);
    const key = (await rpc("select public.challenge_creator_get($1)", [c.id])).questions as any[];
    const play = async (user: string, correct: number) => {
      await as(user);
      const s = await rpc("select public.challenge_start($1)", [c.slug]);
      await rpc("select public.challenge_submit($1,$2)", [s.attempt_id, JSON.stringify(s.questions.map((q: any, i: number) => ({ question_id: q.id, chosen_index: i < correct ? key.find((x) => x.id === q.id).correct_index : (key.find((x) => x.id === q.id).correct_index + 1) % 4 })))]);
    };
    await play(P1, 3); await play(P1, 1);          // two attempts: a high score first, a low one second
    await play(P2, 2);                              // one attempt
    await as(P3); await rpc("select public.challenge_start($1)", [c.slug]);   // started, never finished

    await as(TEACHER);
    const out = await rpc("select public.challenge_participants($1)", [c.id]);
    expect(out.max_attempts).toBe(2);
    const by = Object.fromEntries(out.rows.map((r: any) => [r.name, r]));
    expect(by["Kofi B."]).toMatchObject({ attempts: 2, finished: 2, best_score: 3, max_score: 3 });
    expect(by["Abena O."]).toMatchObject({ attempts: 1, finished: 1, best_score: 2 });
    expect(by["Yaw D."]).toMatchObject({ attempts: 1, finished: 0, best_score: null });
    expect(out.rows.map((r: any) => r.name)).toEqual(["Kofi B.", "Abena O.", "Yaw D."]);   // best score first, unfinished last
    expect(JSON.stringify(out)).not.toMatch(/@example\.com|user_id/);                       // no email addresses or ids

    await as(OTHER_TEACHER); await expect(db.query("select public.challenge_participants($1)", [c.id])).rejects.toThrow(/NOT_AUTHORIZED/);
    await as(P1); await expect(db.query("select public.challenge_participants($1)", [c.id])).rejects.toThrow(/NOT_AUTHORIZED/);
    await as(null); await expect(db.query("select public.challenge_participants($1)", [c.id])).rejects.toThrow(/permission denied|NOT_AUTHORIZED/);
  });

  it("the rollback removes only this function", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await rpc("select count(*)::int from pg_proc where proname = 'challenge_participants'")).toBe(0);
    expect(await rpc("select count(*)::int from pg_proc where proname = 'challenge_analytics'")).toBe(1);
    await db.exec(MIGRATION);
  });
});
