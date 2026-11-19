import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// December 2026 release-readiness gate, defects D-01 to D-04 (isolated PostgreSQL with the few tables the correction touches, old rules first).
// The full-database proof is supabase/tests/december_readiness_gate.sql; this file keeps the correction itself under test in CI.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261120100000_learner_profile_write_guards.sql");
const ROLLBACK = read("../../supabase/rollback/learner_profile_write_guards.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [LEARNER, TEACHER_A, TEACHER_B] = [1, 2, 3].map(id);
const [CLASS_A, CLASS_B, CLASS_LEGACY] = [11, 12, 13].map(id);
let db: PGlite;
const as = async (user: string) => { await db.exec(`select set_config('request.jwt.claim.sub','${user}',false); set role authenticated`); };
const back = async () => { await db.exec("reset role"); };
const refused = async (sql: string) => { try { await db.exec(sql); return null; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const rows = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema quizbox_private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique not null, grade_code text, is_minor boolean not null default false, managed_by uuid);
    create table public.teacher_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique not null, school_name text not null default 'x');
    create table public.classes(id uuid primary key, join_code text not null, class_name text not null, teacher_user_id uuid not null, status text default 'active');
    create table public.assignments(id uuid primary key default gen_random_uuid(), class_id uuid, teacher_user_id uuid not null, title text);
    -- Stand-in for the real qb_can_manage_class: the class belongs to the caller.
    create function public.qb_can_manage_class(p uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.classes c where c.id = p and c.teacher_user_id = auth.uid()) $$;
    alter table public.student_profiles enable row level security; alter table public.teacher_profiles enable row level security;
    alter table public.classes enable row level security; alter table public.assignments enable row level security;
    -- The rules as they stood before this correction (initial schema and 20261002 policies).
    create policy student_self on public.student_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy teacher_self on public.teacher_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy assignments_teacher_owner on public.assignments for all using (teacher_user_id = (select auth.uid())) with check (teacher_user_id = (select auth.uid()));
    create policy classes_all on public.classes for all using (teacher_user_id = auth.uid()) with check (teacher_user_id = auth.uid());
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage on schema auth to authenticated; grant execute on function public.qb_can_manage_class(uuid) to authenticated;
    insert into public.student_profiles(user_id, grade_code, is_minor, managed_by) values ('${LEARNER}', 'B4', true, '${TEACHER_A}');
    insert into public.classes values ('${CLASS_A}', 'QB07-AAAAAAAAAAAA', 'Class A', '${TEACHER_A}', 'active'), ('${CLASS_B}', 'QB07-BBBBBBBBBBBB', 'Class B', '${TEACHER_B}', 'active'),
      ('${CLASS_LEGACY}', 'QB04-OLD', 'Legacy short code', '${TEACHER_A}', 'active');
  `);
}, 60_000);
afterAll(async () => { await db.close(); });

describe("before the correction (documents the defects)", () => {
  it("a learner can edit their own minor flag, make a teacher profile, and a teacher can write into another teacher's class", async () => {
    await as(LEARNER);
    expect(await refused(`update public.student_profiles set is_minor = false, managed_by = null where user_id = '${LEARNER}'`)).toBeNull();
    expect(await refused(`insert into public.teacher_profiles(user_id) values ('${LEARNER}')`)).toBeNull();
    await back(); await as(TEACHER_B);
    expect(await refused(`insert into public.assignments(class_id, teacher_user_id, title) values ('${CLASS_A}', '${TEACHER_B}', 'injected')`)).toBeNull();
    await back();
    await db.exec(`delete from public.assignments; delete from public.teacher_profiles; update public.student_profiles set is_minor = true, managed_by = '${TEACHER_A}'`);
  });
});

describe("20261120100000_learner_profile_write_guards", () => {
  beforeAll(async () => { await db.exec(MIGRATION); });

  it("applies again without error", async () => { await db.exec(MIGRATION); });

  it("D-01: a learner still reads their own profile but cannot write, create or delete profile rows", async () => {
    await as(LEARNER);
    expect(await rows(`select count(*)::int n from public.student_profiles where user_id = '${LEARNER}'`)).toBe(1);
    expect(await refused(`update public.student_profiles set is_minor = false, managed_by = null where user_id = '${LEARNER}'`)).toBe("42501");
    expect(await refused(`update public.student_profiles set managed_by = '${TEACHER_B}' where user_id = '${LEARNER}'`)).toBe("42501");
    expect(await refused(`insert into public.teacher_profiles(user_id) values ('${LEARNER}')`)).toBe("42501");
    expect(await refused(`delete from public.student_profiles where user_id = '${LEARNER}'`)).toBe("42501");
    await back();
    expect(await rows(`select count(*)::int n from public.student_profiles where is_minor and managed_by = '${TEACHER_A}'`)).toBe(1);   // unchanged
    expect(await rows(`select count(*)::int n from public.teacher_profiles`)).toBe(0);
  });

  it("D-01: server-side writes (owner / security definer / service role) are unaffected", async () => {
    await db.exec(`update public.student_profiles set grade_code = 'B5' where user_id = '${LEARNER}'; insert into public.teacher_profiles(user_id) values ('${TEACHER_A}');`);
    expect(await rows(`select count(*)::int n from public.student_profiles where grade_code = 'B5'`)).toBe(1);
  });

  it("D-01: a teacher reads their own teacher profile and nobody else's", async () => {
    await as(TEACHER_A);
    expect(await rows(`select count(*)::int n from public.teacher_profiles`)).toBe(1);
    await back(); await as(TEACHER_B);
    expect(await rows(`select count(*)::int n from public.teacher_profiles`)).toBe(0);
    await back();
  });

  it("D-02: a teacher cannot write an assignment into another teacher's class, but can into their own", async () => {
    await as(TEACHER_B);
    expect(await refused(`insert into public.assignments(class_id, teacher_user_id, title) values ('${CLASS_A}', '${TEACHER_B}', 'injected')`)).toBe("42501");
    expect(await refused(`insert into public.assignments(class_id, teacher_user_id, title) values ('${CLASS_B}', '${TEACHER_B}', 'own class')`)).toBeNull();
    expect(await refused(`insert into public.assignments(class_id, teacher_user_id, title) values ('${CLASS_B}', '${TEACHER_A}', 'as someone else')`)).toBe("42501");
    await back();
    expect(await rows(`select count(*)::int n from public.assignments where title = 'injected'`)).toBe(0);
  });

  it("D-03: a join code cannot be reused in another letter case", async () => {
    expect(await refused(`insert into public.classes values ('${id(21)}', 'qb07-aaaaaaaaaaaa', 'Look-alike', '${TEACHER_B}', 'active')`)).toBe("23505");
    expect(await refused(`insert into public.classes values ('${id(22)}', 'QB07-CCCCCCCCCCCC', 'Fresh code', '${TEACHER_B}', 'active')`)).toBeNull();
  });

  it("D-04: a short or odd class code is refused when set, and an existing class with an older short code can still be renamed or archived", async () => {
    for (const code of ["A1", "QB07-SHRT", "QB07 SPACES HERE", "QB07-€€€€€€€€€€", ""]) {
      expect(await refused(`insert into public.classes values ('${id(30)}', '${code}', 'Weak', '${TEACHER_B}', 'active')`)).toBe("22023");
    }
    expect(await refused(`update public.classes set class_name = 'Legacy renamed', status = 'archived' where id = '${CLASS_LEGACY}'`)).toBeNull();
    expect(await refused(`update public.classes set join_code = 'ABC' where id = '${CLASS_LEGACY}'`)).toBe("22023");     // but not changed TO a weak code
  });

  it("refuses to apply while two classes already share a code in different letter case, and names the code", async () => {
    const other = new PGlite();
    await other.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create table public.student_profiles(user_id uuid); create table public.teacher_profiles(user_id uuid);
      create table public.classes(id uuid primary key default gen_random_uuid(), join_code text not null);
      create table public.assignments(teacher_user_id uuid, class_id uuid);
      create function public.qb_can_manage_class(uuid) returns boolean language sql as $$ select true $$;
      insert into public.classes(join_code) values ('QB07-DUPLICATEAAAA'), ('qb07-duplicateaaaa');
    `);
    await expect(other.exec(MIGRATION)).rejects.toThrow(/CLASS_JOIN_CODE_DUPLICATES.*QB07-DUPLICATEAAAA/);
    await other.close();
  });

  it("rollback restores the previous rules exactly", async () => {
    await db.exec(ROLLBACK);
    await as(LEARNER);
    expect(await refused(`update public.student_profiles set is_minor = false where user_id = '${LEARNER}'`)).toBeNull();
    await back();
    expect(await refused(`insert into public.classes values ('${id(40)}', 'A1', 'Weak again', '${TEACHER_B}', 'active')`)).toBeNull();
    await db.exec(MIGRATION);   // and it can be applied again afterwards
  });
});
