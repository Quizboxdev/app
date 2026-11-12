import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Editing a challenge's details while it is live (isolated PostgreSQL). The foundation migration is applied unchanged, then the live-details migration on top of it.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const FOUNDATION = read("../../supabase/migrations/20261021100000_challenges_foundation.sql");
const MIGRATION = read("../../supabase/migrations/20261065100000_challenge_live_details.sql");
const ROLLBACK = read("../../supabase/rollback/challenge_live_details.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, OTHER_TEACHER] = [1, 2, 4].map(id);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const qs = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ question_text: `Question number ${i + 1}?`, options: ["one", "two", "three", "four"], correct_index: i % 4, explanation: "because" })));
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const update = (cid: string, patch: Record<string, unknown>) => rpc("select public.challenge_update($1,$2)", [cid, JSON.stringify(patch)]);
// A published challenge (3 questions) with the given opening and closing time.
async function live(title: string, starts: string | null = null, ends: string | null = null) {
  await as(TEACHER);
  const made = await rpc("select public.challenge_create($1,'A quick test','general_knowledge','PUBLIC',3,600,1,$2,$3,null,null)", [title, starts, ends]);
  await rpc("select public.challenge_set_questions($1,$2)", [made.id, qs(3)]);
  await rpc("select public.challenge_publish($1)", [made.id]);
  return made.id as string;
}
const row = async (cid: string) => { await db.exec("reset role"); return (await db.query<Record<string, any>>("select title, summary, starts_at, ends_at, status from public.challenge_campaigns where id=$1", [cid])).rows[0]; };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin')), active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.questions(id uuid primary key default gen_random_uuid(), subject_code text, grade text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text, status text default 'active', answer_type text default 'SINGLE_CHOICE');
    insert into public.profiles values ('${OWNER}','OWNER','active','Site Owner'),('${TEACHER}','TEACHER','active','Efua Mensah'),('${OTHER_TEACHER}','TEACHER','active','Yaw Asante');
  `);
  await db.exec(FOUNDATION);
  await db.exec(MIGRATION);
  await db.exec("grant select on public.profiles to authenticated");
});
afterAll(async () => { await db.close(); });

describe("editing a live challenge", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("changes the title, description and closing time of a live challenge", async () => {
    const cid = await live("Maths Sprint", null, hours(24));
    const later = hours(72);
    expect((await update(cid, { title: "Maths Sprint (extended)", summary: "Now open for three days", ends_at: later })).ok).toBe(true);
    const r = await row(cid);
    expect(r.title).toBe("Maths Sprint (extended)"); expect(r.summary).toBe("Now open for three days"); expect(r.status).toBe("LIVE");
    expect(new Date(r.ends_at).getTime()).toBe(new Date(later).getTime());
  });

  it("keeps questions and scoring locked", async () => {
    const cid = await live("Locked Rules");
    await as(TEACHER);
    for (const patch of [{ question_count: 9 }, { time_limit_seconds: 30 }, { max_attempts: 5 }, { visibility: "PRIVATE" }, { category: "maths" }]) await fails("select public.challenge_update($1,$2)", [cid, JSON.stringify(patch)], /ONLY_DRAFT_EDITABLE/);
    await fails("select public.challenge_set_questions($1,$2)", [cid, qs(3)], /ONLY_DRAFT_EDITABLE/);
    await fails("select public.challenge_update($1,'{\"owner_id\":\"x\"}')", [cid], /FIELD_NOT_EDITABLE/);
  });

  it("refuses a closing time that has already passed, and before the opening time", async () => {
    const cid = await live("Dates", null, hours(24));
    await as(TEACHER);
    await fails("select public.challenge_update($1,$2)", [cid, JSON.stringify({ ends_at: hours(-1) })], /ENDS_IN_THE_PAST/);
    const draft = await rpc("select public.challenge_create('Draft Dates','x','general_knowledge','PUBLIC',3,600,1,$1,null,null,null)", [hours(48)]);
    await fails("select public.challenge_update($1,$2)", [draft.id, JSON.stringify({ ends_at: hours(24) })], /INVALID_DATES/);
    expect((await update(draft.id, { ends_at: hours(72) })).ok).toBe(true);
  });

  it("does not move the opening time once the challenge has opened, but can before it opens", async () => {
    const open = await live("Already Open");
    await as(TEACHER);
    await fails("select public.challenge_update($1,$2)", [open, JSON.stringify({ starts_at: hours(5) })], /ALREADY_OPENED/);
    const opens = hours(10);
    const scheduled = await live("Opens Tomorrow", opens);
    expect((await update(scheduled, { starts_at: hours(30) })).ok).toBe(true);
    expect((await update(scheduled, { title: "Opens Later" })).ok).toBe(true);
  });

  it("is refused once the challenge has ended, and for someone else's challenge", async () => {
    const cid = await live("Ends Here");
    await as(OTHER_TEACHER); await fails("select public.challenge_update($1,'{\"title\":\"Mine now\"}')", [cid], /NOT_AUTHORIZED/);
    await as(TEACHER); await rpc("select public.challenge_set_status($1,'COMPLETED')", [cid]);
    await fails("select public.challenge_update($1,'{\"title\":\"Too late\"}')", [cid], /CHALLENGE_ENDED/);
  });

  it("records what changed", async () => {
    const cid = await live("Audited", null, hours(24));
    await update(cid, { title: "Audited again", ends_at: hours(48) });
    await db.exec("reset role");
    const log = (await db.query<Record<string, any>>("select details from public.audit_logs where entity_id=$1 and action='challenge_updated' order by id desc limit 1", [cid])).rows[0];
    expect(log.details.status).toBe("LIVE"); expect(log.details.title_from).toBe("Audited"); expect(log.details.fields).toEqual(expect.arrayContaining(["title", "ends_at"]));
  });

  it("rolls back to the original, which allowed a past closing time", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    const cid = await live("After Rollback", null, hours(24));
    expect((await update(cid, { ends_at: hours(-1) })).ok).toBe(true);
    await db.exec("reset role"); await db.exec(MIGRATION);
  });
});
