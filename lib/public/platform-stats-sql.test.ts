import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261012190000_public_platform_stats.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../../supabase/rollback/public_platform_stats.sql", import.meta.url), "utf8");
let db: PGlite;

describe("qb_public_platform_stats (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated;
      create table public.student_profiles(id serial, grade text, grade_code text, education_level text, status text);
      create table public.teacher_profiles(id serial, status text);
      create table public.institutions(id serial, status text);
      create table public.sme_profiles(user_id serial, active boolean, reviewer_status text);
      create table public.sponsor_profiles(id serial, status text);
      create table public.markets(id serial, active boolean, is_test boolean default false);
      create table public.curriculum_nodes(id integer primary key, curriculum_id integer, education_level text, node_type text, is_active boolean default true);
      create table public.market_curricula(curriculum_id integer primary key, active boolean);
      create table public.questions(id serial, curriculum_node_id integer, status text, validation_status text, source_type text);
      insert into public.student_profiles(grade,grade_code,education_level,status) values
        ('B4','B4',null,'active'),('B6',null,null,'active'),('B7','B7',null,'active'),('B9','B9',null,'active'),('B10','SHS1',null,'active'),('SHS2',null,null,'active'),
        ('B5','B5',null,'inactive');
      insert into public.teacher_profiles(status) values('active'),('active'),('inactive');
      insert into public.institutions(status) values('active'),('inactive');
      insert into public.sme_profiles(active,reviewer_status) values(true,'verified'),(true,'pending'),(false,'verified');
      insert into public.sponsor_profiles(status) values('ACTIVE'),('SUSPENDED'),('PENDING');
      insert into public.markets(active,is_test) values(true,false),(true,true),(false,false);
      insert into public.market_curricula values(1,true),(2,false);
      insert into public.curriculum_nodes values(1,1,'Primary','learning_indicator',true),(2,1,'Primary','learning_indicator',true),(3,1,'JHS','learning_indicator',true),
        (4,1,'SHS','learning_indicator',false),(5,2,'SHS','learning_indicator',true),(6,1,'Primary','strand',true);
      insert into public.questions(curriculum_node_id,status,validation_status,source_type) values
        (1,'active','approved','IMPORTED'),(1,'active','validated','IMPORTED'),(3,'active','approved','IMPORTED'),(3,'active','review','IMPORTED'),
        (1,'active','approved','DEV_FACTORY_PILOT'),(3,'archived','approved','IMPORTED'),(null,'active','approved','IMPORTED');
    `);
    await db.exec(MIGRATION);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("counts people and content from the tables, excluding inactive records and test fixtures", async () => {
    const r = (await db.query<{ v: any }>("select public.qb_public_platform_stats() v")).rows[0].v;
    expect(r.learners).toEqual({ total: 6, primary: 2, jhs: 2, shs: 2 });
    expect(r.people).toEqual({ teachers: 2, reviewers: 1, schools: 1, sponsors: 2, markets: 1 });
    expect(r.questions).toEqual({ total: 4, primary: 2, jhs: 1, shs: 0 });   // 3 linked; the unlinked approved one counts in the total only
    expect(r.indicators).toEqual({ total: 3, primary: 2, jhs: 1, shs: 0 });  // active nodes of active market curricula, indicators only
    expect(typeof r.as_of).toBe("string");
  });

  it("returns only counts: no key besides the five aggregates, no row-level value", async () => {
    const r = (await db.query<{ v: any }>("select public.qb_public_platform_stats() v")).rows[0].v;
    expect(Object.keys(r).sort()).toEqual(["as_of", "indicators", "learners", "people", "questions"]);
    const numbers = [...Object.values(r.learners), ...Object.values(r.questions), ...Object.values(r.indicators), ...Object.values(r.people)];
    expect(numbers.every((n) => typeof n === "number")).toBe(true);
  });

  it("is executable by anon and rolls back cleanly", async () => {
    await db.exec("set role anon");
    expect((await db.query("select public.qb_public_platform_stats() v")).rows).toHaveLength(1);
    await db.exec("reset role");
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regprocedure('public.qb_public_platform_stats()') f")).rows[0]).toEqual({ f: null });
  });
});
