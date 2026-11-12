import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Joining a class by code now refuses a learner whose class level differs from the class (isolated PostgreSQL with the few tables the join touches).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261063100000_class_join_level_check.sql");
const ROLLBACK = read("../../supabase/rollback/class_join_level_check.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MARKET = id(900);
const [B4_KID, NO_GRADE, LEGACY_SHS, ALIAS_KID] = [1, 2, 3, 4].map(id);
const [C_B4, C_B5, C_SHS3, C_SHS1, C_JHS1] = [11, 12, 13, 14, 15].map(id);
let db: PGlite;
const as = (user: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
const join = async (user: string, code: string) => { await as(user); return (await db.query<{ r: any }>("select public.qb_join_class($1) as r", [code])).rows[0].r; };
const members = async (user: string) => (await db.query<{ n: number }>("select count(*)::int as n from public.class_memberships where student_user_id=$1 and status::text='active'", [user])).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth; create schema quizbox_private; create schema quizbox_market;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create type public.qb_status as enum ('active','archived');
    create table public.markets(id uuid primary key, configuration jsonb);
    create table public.profiles(id uuid primary key, email text, full_name text, primary_market_id uuid, default_market_id uuid);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, grade text, grade_code text, status text default 'active');
    create table public.classes(id uuid primary key, class_name text, grade text, grade_code text, status public.qb_status default 'active', join_code text, join_code_expires_at timestamptz);
    create table public.class_memberships(id uuid primary key default gen_random_uuid(), class_id uuid, student_id uuid, student_user_id uuid, student_email text, student_name text, grade text, status public.qb_status, left_at timestamptz, unique(class_id, student_id));
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, status text, details jsonb);
    create function public.qb_current_student_id() returns uuid language sql stable as $$ select id from public.student_profiles where user_id = auth.uid() limit 1 $$;
    create function quizbox_private.consume_budget(a text, b integer, c integer) returns boolean language sql as $$ select true $$;
    -- The real definition from 20261003120000_market_grade_codes.sql
    create function quizbox_market.student_grade_code(p_user uuid) returns text language sql stable security definer set search_path='' as $$
     select coalesce((select x->>'canonical' from public.profiles p join public.markets m on m.id=coalesce(p.primary_market_id,p.default_market_id)
       cross join jsonb_array_elements(coalesce(m.configuration->'grades','[]')) x where p.id=s.user_id and x->>'code'=s.g and nullif(x->>'canonical','') is not null limit 1),
       case when s.g='B10' then 'SHS1' else s.g end)
     from (select user_id,coalesce(nullif(grade_code,''),grade::text) g from public.student_profiles where user_id=p_user and lower(status::text)='active' limit 1) s;
    $$;
    insert into public.markets values ('${MARKET}', '{"grades":[{"code":"B4","canonical":"B4"},{"code":"B5","canonical":"B5"},{"code":"SHS3","canonical":"SHS3"},{"code":"JHS1","canonical":"B7"},{"code":"B7","canonical":"B7"}]}');
    insert into public.profiles values ('${B4_KID}','b4@example.com','Kofi B',null,'${MARKET}'),('${NO_GRADE}','ng@example.com','Ama N',null,'${MARKET}'),('${LEGACY_SHS}','ls@example.com','Yaw L',null,'${MARKET}'),('${ALIAS_KID}','al@example.com','Efua A',null,'${MARKET}');
    insert into public.student_profiles(user_id, grade_code) values ('${B4_KID}','B4'),('${NO_GRADE}',null),('${LEGACY_SHS}','B10'),('${ALIAS_KID}','B7');
    insert into public.classes(id, class_name, grade_code, join_code) values
      ('${C_B4}','Basic 4','B4','QB04-AAAA'),('${C_B5}','Basic 5','B5','QB05-BBBB'),('${C_SHS3}','SHS 3','SHS3','QB03-CCCC'),('${C_SHS1}','SHS 1','SHS1','QB01-DDDD'),('${C_JHS1}','JHS 1','JHS1','QB01-EEEE');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("joining a class checks the class level", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("lets a learner into a class of their own level", async () => {
    expect(await join(B4_KID, "QB04-AAAA")).toMatchObject({ class_name: "Basic 4", status: "active" });
    expect(await members(B4_KID)).toBe(1);
  });

  it("refuses a Basic 4 learner for Basic 5 and SHS 3 with a clear code, and leaves no membership", async () => {
    expect(await join(B4_KID, "QB05-BBBB")).toEqual({ error: "CLASS_LEVEL_MISMATCH" });
    expect(await join(B4_KID, "QB03-CCCC")).toEqual({ error: "CLASS_LEVEL_MISMATCH" });
    expect(await members(B4_KID)).toBe(1);   // still only Basic 4
    const logged = (await db.query<{ n: number }>("select count(*)::int as n from public.audit_logs where action='QB_OP_CLASS_JOIN' and details->>'error_code'='CLASS_LEVEL_MISMATCH'")).rows[0].n;
    expect(logged).toBe(2);
  });

  it("treats a legacy B10 learner as SHS 1, and a renamed level as the same level", async () => {
    expect(await join(LEGACY_SHS, "QB01-DDDD")).toMatchObject({ class_name: "SHS 1" });
    expect(await join(LEGACY_SHS, "QB05-BBBB")).toEqual({ error: "CLASS_LEVEL_MISMATCH" });
    expect(await join(ALIAS_KID, "QB01-EEEE")).toMatchObject({ class_name: "JHS 1" });   // JHS1 is the market's name for the learner's B7
  });

  it("does not block a learner whose own level is not known", async () => {
    expect(await join(NO_GRADE, "QB05-BBBB")).toMatchObject({ class_name: "Basic 5" });
  });

  it("rejoining the same class after leaving still works, and the other errors are unchanged", async () => {
    await db.exec(`update public.class_memberships set status='archived', left_at=now() where student_user_id='${B4_KID}'`);
    expect(await join(B4_KID, "QB04-AAAA")).toMatchObject({ class_name: "Basic 4", status: "active" });
    expect(await join(B4_KID, "NOPE")).toEqual({ error: "INVALID_CLASS_CODE" });
    await db.exec(`update public.classes set status='archived' where id='${C_B4}'`);
    expect(await join(B4_KID, "QB04-AAAA")).toEqual({ error: "CLASS_NOT_ACTIVE" });
    await db.exec(`update public.classes set status='active' where id='${C_B4}'`);
  });

  it("the rollback removes only the level check", async () => {
    await db.exec(ROLLBACK);
    expect(await join(B4_KID, "QB05-BBBB")).toMatchObject({ class_name: "Basic 5" });   // the old behaviour: anyone with a code gets in
    await db.exec(MIGRATION);
    expect(await join(ALIAS_KID, "QB05-BBBB")).toEqual({ error: "CLASS_LEVEL_MISMATCH" });
  });
});
