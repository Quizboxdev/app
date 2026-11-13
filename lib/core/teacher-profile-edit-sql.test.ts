import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A teacher edits their own name, school, subjects and grades taught (20261069100000), on an isolated PostgreSQL. Closed until flags.teacher_profile_edit is on.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261069100000_teacher_profile_edit.sql");
const ROLLBACK = read("../../supabase/rollback/teacher_profile_edit.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MARKET = id(900), INSTITUTION = id(910);
const [ABENA, KWESI, SCHOOL_TEACHER, LEARNER] = [1, 2, 3, 4].map(id);
let db: PGlite;
const as = async (user: string | null) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec("set role authenticated"); };
const admin = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); };
const setFlag = async (on: boolean) => { await admin(); await db.query("update public.platform_settings set value = $1::jsonb where key = 'flags.teacher_profile_edit'", [JSON.stringify(on)]); };
const edit = async (user: string, a: { name?: string | null; school?: string | null; subjects?: string[] | null; grades?: string[] | null }) => {
  await as(user);
  return (await db.query<{ r: any }>("select public.qb_teacher_profile_status() s, public.qb_update_teacher_profile($1,$2,$3::text[],$4::text[]) as r", [a.name ?? null, a.school ?? null, a.subjects ?? null, a.grades ?? null])).rows[0].r;
};
const row = async (user: string) => { await admin(); return (await db.query<Record<string, any>>("select p.full_name, p.school_name p_school, t.school_name, t.subjects, t.grade_codes, t.education_levels from public.profiles p join public.teacher_profiles t on t.user_id = p.id where p.id = $1", [user])).rows[0]; };
const count = async (sql: string, params: unknown[] = []) => { await admin(); return Number((await db.query<{ n: string }>(sql, params)).rows[0].n); };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    create type public.qb_role as enum ('student','teacher','admin','sponsor');
    create table public.markets(id uuid primary key, configuration jsonb);
    create table public.profiles(id uuid primary key, full_name text not null, role public.qb_role, school_name text, primary_market_id uuid, default_market_id uuid);
    create table public.teacher_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique, school_name text not null, subjects text[] not null default '{}', grade_codes text[] not null default '{}',
      education_levels text[] not null default '{}', institution_id uuid, status text default 'active', updated_at timestamptz default now());
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text not null, entity_type text, entity_id uuid, status text not null default 'pass', details jsonb not null default '{}'::jsonb);
    create table public.platform_settings(id uuid primary key default gen_random_uuid(), key text not null, scope_type text not null default 'global', scope_id uuid, value jsonb not null, description text not null default '');
    create unique index platform_settings_scope_key on public.platform_settings(key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'));
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql stable security definer set search_path = '' as $$
      select coalesce((select value from public.platform_settings where key = p_key and scope_type = 'global') = 'true'::jsonb, false) $$;
    insert into public.markets values ('${MARKET}', '{"grades":[{"code":"B4","level":"PRIMARY"},{"code":"B5","level":"PRIMARY"},{"code":"B7","level":"JHS"},{"code":"SHS1","level":"SHS"}],"subjects":[{"code":"Mathematics"},{"code":"Science"},{"code":"English"},{"code":"French"}]}');
    insert into public.profiles values ('${ABENA}','Abena Owusu','teacher','Old School','${MARKET}',null),('${KWESI}','Kwesi Addo','teacher','Other School','${MARKET}',null),
      ('${SCHOOL_TEACHER}','Esi Quaye','teacher','Org School','${MARKET}',null),('${LEARNER}','Kofi Mensah','student',null,'${MARKET}',null);
    insert into public.teacher_profiles(user_id, school_name, subjects, grade_codes, education_levels, institution_id) values
      ('${ABENA}','Old School','{Mathematics}','{B4}','{PRIMARY}',null),('${KWESI}','Other School','{English}','{B7}','{JHS}',null),('${SCHOOL_TEACHER}','Org School','{Science}','{B5}','{PRIMARY}','${INSTITUTION}');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("a teacher edits their own profile", () => {
  it("re-applies cleanly and ships off", async () => {
    await db.exec(MIGRATION);
    await admin();
    expect((await db.query<{ value: unknown }>("select value from public.platform_settings where key = 'flags.teacher_profile_edit'")).rows[0].value).toBe(false);
  });

  it("is closed while the flag is off, and nothing changes", async () => {
    await expect(edit(ABENA, { school: "New School" })).rejects.toThrow(/QB_FEATURE_DISABLED/);
    expect(await row(ABENA)).toMatchObject({ school_name: "Old School" });
    await as(ABENA);
    expect((await db.query<{ s: any }>("select public.qb_teacher_profile_status() s")).rows[0].s).toMatchObject({ enabled: false, eligible: true });
  });

  it("is closed to the browser's table and to signed-out callers", async () => {
    await expect(db.query("select * from public.account_profile_edits")).rejects.toThrow(/permission denied/);
    await as(null);
    await expect(db.query("select public.qb_update_teacher_profile('X Y')")).rejects.toThrow(/NOT_AUTHORIZED/);
    await db.exec("reset role"); await db.exec("set role anon");
    await expect(db.query("select public.qb_update_teacher_profile('X Y')")).rejects.toThrow(/permission denied/);
  });

  it("changes name, school, subjects and grades, and the education levels follow the grades", async () => {
    await setFlag(true);
    const r = await edit(ABENA, { name: "Abena Owusu-Ansah", school: "New School", subjects: ["Science", "Mathematics", "Science"], grades: ["B7", "SHS1", "B7"] });
    expect(r).toMatchObject({ ok: true, enabled: true, eligible: true, school_locked: false });
    expect(await row(ABENA)).toMatchObject({ full_name: "Abena Owusu-Ansah", p_school: "New School", school_name: "New School", subjects: ["Mathematics", "Science"], grade_codes: ["B7", "SHS1"], education_levels: ["JHS", "SHS"] });
  });

  it("leaves what is not sent as it was", async () => {
    await edit(ABENA, { subjects: ["French"] });
    expect(await row(ABENA)).toMatchObject({ full_name: "Abena Owusu-Ansah", school_name: "New School", subjects: ["French"], grade_codes: ["B7", "SHS1"], education_levels: ["JHS", "SHS"] });
  });

  it("refuses a name that is too short, a blank school, and values outside the market's lists", async () => {
    await expect(edit(ABENA, { name: " A " })).rejects.toThrow(/INVALID_NAME/);
    await expect(edit(ABENA, { school: "   " })).rejects.toThrow(/QB_SCHOOL_REQUIRED/);
    await expect(edit(ABENA, { subjects: ["Astrology"] })).rejects.toThrow(/INVALID_SUBJECT/);
    await expect(edit(ABENA, { grades: ["B99"] })).rejects.toThrow(/INVALID_GRADE/);
    expect(await row(ABENA)).toMatchObject({ subjects: ["French"], grade_codes: ["B7", "SHS1"] });
  });

  it("refuses a save that changes nothing, and does not write history for it", async () => {
    const before = await count("select count(*) n from public.account_profile_edits where user_id = $1", [ABENA]);
    await expect(edit(ABENA, { school: "New School", subjects: ["French"] })).rejects.toThrow(/NOTHING_CHANGED/);
    expect(await count("select count(*) n from public.account_profile_edits where user_id = $1", [ABENA])).toBe(before);
  });

  it("keeps each saved change, with before and after, in the history and the audit log", async () => {
    await admin();
    const h = (await db.query<{ kind: string; before: any; after: any }>("select kind, before, after from public.account_profile_edits where user_id = $1 order by edited_at, id", [ABENA])).rows;
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ kind: "teacher", before: { school_name: "Old School", subjects: ["Mathematics"] }, after: { school_name: "New School", full_name: "Abena Owusu-Ansah" } });
    expect(await count("select count(*) n from public.audit_logs where actor_user_id = $1 and action = 'teacher_profile_edited'", [ABENA])).toBe(2);
  });

  it("does not touch another teacher's details", async () => {
    expect(await row(KWESI)).toMatchObject({ full_name: "Kwesi Addo", school_name: "Other School", subjects: ["English"], grade_codes: ["B7"] });
  });

  it("a teacher who belongs to a school organisation cannot change the school, but can change the rest", async () => {
    await as(SCHOOL_TEACHER);
    expect((await db.query<{ s: any }>("select public.qb_teacher_profile_status() s")).rows[0].s).toMatchObject({ school_locked: true });
    await expect(edit(SCHOOL_TEACHER, { school: "Somewhere Else" })).rejects.toThrow(/SCHOOL_LOCKED/);
    await edit(SCHOOL_TEACHER, { subjects: ["Mathematics", "Science"] });
    expect(await row(SCHOOL_TEACHER)).toMatchObject({ school_name: "Org School", subjects: ["Mathematics", "Science"] });
  });

  it("only a teacher can use it", async () => {
    await expect(edit(LEARNER, { name: "Kofi M" })).rejects.toThrow(/NOT_A_TEACHER/);
    await as(LEARNER);
    expect((await db.query<{ s: any }>("select public.qb_teacher_profile_status() s")).rows[0].s).toMatchObject({ eligible: false, reason: "NOT_A_TEACHER" });
  });

  it("rolls back cleanly and can be applied again", async () => {
    await admin();
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regclass('public.account_profile_edits') t, to_regprocedure('public.qb_update_teacher_profile(text,text,text[],text[])') f")).rows[0]).toMatchObject({ t: null, f: null });
    expect((await db.query("select count(*)::int n from public.platform_settings where key = 'flags.teacher_profile_edit'")).rows[0]).toMatchObject({ n: 0 });
    expect(await row(ABENA)).toMatchObject({ school_name: "New School" });
    await db.exec(MIGRATION);
    expect((await db.query<{ f: unknown }>("select to_regprocedure('public.qb_update_teacher_profile(text,text,text[],text[])') f")).rows[0].f).not.toBeNull();
  });
});
