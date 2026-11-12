import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A learner edits their own class level, school and subjects, at most twice in any six months (isolated PostgreSQL with the few tables the change touches).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261066100000_student_profile_edits.sql");
const ROLLBACK = read("../../supabase/rollback/student_profile_edits.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MARKET = id(900);
const [KOFI, AMA, CHILD, TEACHER, NEW_KID] = [1, 2, 3, 4, 5].map(id);
let db: PGlite;
const as = (user: string | null) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
const status = async (user: string) => { await as(user); return (await db.query<{ r: any }>("select public.qb_profile_edit_status() as r")).rows[0].r; };
const edit = async (user: string, grade: string | null, school: string | null = null, subjects: string[] | null = null) => {
  await as(user);
  return (await db.query<{ r: any }>("select public.qb_update_student_profile($1,$2,$3::text[]) as r", [grade, school, subjects])).rows[0].r;
};
const fails = async (user: string, grade: string | null, message: RegExp, school: string | null = null, subjects: string[] | null = null) => { await expect(edit(user, grade, school, subjects)).rejects.toThrow(message); };
const profile = async (user: string) => (await db.query<Record<string, any>>("select grade::text as grade, grade_code, education_level, school_name, subjects from public.student_profiles where user_id=$1", [user])).rows[0];
const age = (user: string, months: number) => db.query("update public.student_profile_edits set edited_at = edited_at - ($2 || ' months')::interval where user_id=$1", [user, String(months)]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create type public.qb_grade as enum ('B7','B8','B9');
    create type public.qb_role as enum ('student','teacher','admin','sponsor');
    create table public.markets(id uuid primary key, configuration jsonb);
    create table public.profiles(id uuid primary key, role public.qb_role, school_name text, primary_market_id uuid, default_market_id uuid);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique, grade public.qb_grade, grade_code text, education_level text, school_name text, subjects text[] not null default '{}',
      managed_by uuid, status text default 'active', updated_at timestamptz default now());
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), n bigserial, actor_user_id uuid, action text not null, entity_type text, entity_id uuid, status text not null default 'pass', details jsonb not null default '{}'::jsonb);
    insert into public.markets values ('${MARKET}', '{"grades":[{"code":"B4","level":"PRIMARY"},{"code":"B5","level":"PRIMARY"},{"code":"B7","level":"JHS"},{"code":"SHS1","level":"SHS"}],"subjects":[{"code":"Mathematics"},{"code":"Science"},{"code":"FRENCH"}]}');
    insert into public.profiles values ('${KOFI}','student',null,'${MARKET}',null),('${AMA}','student','Old School','${MARKET}',null),('${CHILD}','student',null,'${MARKET}',null),('${TEACHER}','teacher',null,'${MARKET}',null),('${NEW_KID}','student',null,'${MARKET}',null);
    insert into public.student_profiles(user_id, grade_code, education_level, school_name, subjects, managed_by) values
      ('${KOFI}','B4','PRIMARY','Accra Primary','{Mathematics,Science}',null),('${AMA}','B7','JHS','Old School','{Mathematics}',null),('${CHILD}','B4','PRIMARY',null,'{}','${TEACHER}');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("a learner edits their own profile, twice in six months", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("starts with two edits available and nothing used", async () => {
    expect(await status(KOFI)).toMatchObject({ eligible: true, reason: null, limit: 2, window_months: 6, used: 0, remaining: 2, next_edit_at: null });
  });

  it("changes the class level, with the education level following it, and says one edit is left", async () => {
    const r = await edit(KOFI, "B7");
    expect(r).toMatchObject({ ok: true, used: 1, remaining: 1, eligible: true });
    expect(await profile(KOFI)).toMatchObject({ grade: "B7", grade_code: "B7", education_level: "JHS", school_name: "Accra Primary" });
  });

  it("a class level outside the legacy list is stored by code, with no legacy value", async () => {
    await edit(KOFI, "SHS1");
    expect(await profile(KOFI)).toMatchObject({ grade: null, grade_code: "SHS1", education_level: "SHS" });
  });

  it("the third edit within six months is refused, and says when the next one opens", async () => {
    await expect(edit(KOFI, "B5")).rejects.toThrow(/PROFILE_EDIT_LIMIT/);
    const s = await status(KOFI);
    expect(s).toMatchObject({ used: 2, remaining: 0 });
    expect(new Date(s.next_edit_at).getTime()).toBeGreaterThan(Date.now() + 170 * 86400_000);
    expect(await profile(KOFI)).toMatchObject({ grade_code: "SHS1" });
  });

  it("the oldest edit stops counting after six months, so one more opens", async () => {
    await db.query("update public.student_profile_edits set edited_at = now() - interval '7 months' where id = (select id from public.student_profile_edits where user_id=$1 order by edited_at limit 1)", [KOFI]);
    expect(await status(KOFI)).toMatchObject({ used: 1, remaining: 1 });
    expect((await edit(KOFI, "B5")).remaining).toBe(0);
    await age(KOFI, 7);
    expect(await status(KOFI)).toMatchObject({ used: 0, remaining: 2 });
  });

  it("changes the school and the subjects, which the market list controls", async () => {
    const r = await edit(AMA, null, "  New School  ", ["FRENCH", "Mathematics", "FRENCH"]);
    expect(r.remaining).toBe(1);
    expect(await profile(AMA)).toMatchObject({ grade_code: "B7", school_name: "New School", subjects: ["FRENCH", "Mathematics"] });
    expect((await db.query<{ s: string }>("select school_name s from public.profiles where id=$1", [AMA])).rows[0].s).toBe("New School");
    await edit(AMA, null, "");
    expect((await profile(AMA)).school_name).toBeNull();
  });

  it("refuses a class level or subject the market does not offer, and a save that changes nothing, without using an edit", async () => {
    await age(AMA, 7);
    await fails(AMA, "ZZ9", /INVALID_GRADE/);
    await fails(AMA, null, /INVALID_SUBJECT/, null, ["Latin"]);
    await fails(AMA, "B7", /NOTHING_CHANGED/);
    await fails(AMA, null, /NOTHING_CHANGED/, null, ["FRENCH", "Mathematics"]);
    expect(await status(AMA)).toMatchObject({ used: 0, remaining: 2 });
  });

  it("is only for self-registered learners: managed learners, teachers and signed-out callers cannot", async () => {
    expect(await status(CHILD)).toMatchObject({ eligible: false, reason: "MANAGED_ACCOUNT" });
    await fails(CHILD, "B5", /MANAGED_ACCOUNT/);
    expect(await status(TEACHER)).toMatchObject({ eligible: false, reason: "NOT_A_STUDENT" });
    await fails(TEACHER, "B5", /NOT_A_STUDENT/);
    await fails(NEW_KID, "B5", /NOT_A_STUDENT/);   // a profile with no student record
    await as(null);
    await expect(db.query("select public.qb_profile_edit_status()")).rejects.toThrow(/NOT_AUTHORIZED/);
  });

  it("keeps a record of what changed", async () => {
    const rows = (await db.query<{ details: any }>("select details from public.audit_logs where action='student_profile_edited' and actor_user_id=$1 order by n", [KOFI])).rows;
    expect(rows.length).toBe(3);
    expect(rows[0].details.before.grade_code).toBe("B4"); expect(rows[0].details.after.grade_code).toBe("B7");
  });

  it("rolls back cleanly", async () => {
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regprocedure('public.qb_update_student_profile(text,text,text[])') as f")).rows[0]).toEqual({ f: null });
    await db.exec(MIGRATION);
  });
});
