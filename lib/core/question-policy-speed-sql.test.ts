import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The question table's market rule is now worked out once per statement (20261119100000) and must give exactly the same answer as the per-row rule did.
// The per-row rule below is a copy of quizbox_market.question_allowed as it stands after migrations 210000, 250000 and 1003100000; the other helpers are small stand-ins.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261119100000_question_policy_speed.sql");
const ROLLBACK = read("../../supabase/rollback/question_policy_speed.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CUR_A = id(1), CUR_B = id(2);
const D = { ok: id(11), notOwned: id(12), pending: id(13), otherCurriculum: id(14), sponsor: id(15) };
const USERS = { plain: id(101), withDocs: id(102), denied: id(103), nothing: id(104), admin: id(105) };
let db: PGlite;
const as = async (uid: string, role: string) => { await db.exec(`select set_config('test.uid', '${uid}', false), set_config('test.role', '${role}', false)`); };
const rows = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema quizbox_market; create schema quizbox_competition;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.source_documents(id uuid primary key, validation_status text, source_kind text, curriculum_id uuid);
    create table public.questions(id uuid primary key, origin_candidate_id uuid, curriculum_id uuid, curriculum_node_id uuid, source_document_ids uuid[], source_type text, tenant_id uuid, created_at timestamptz default now());
    create table public.legacy_content_attributions(question_id uuid, curriculum_id uuid);
    create table t_owned(uid uuid, doc uuid);
    create table t_cur(uid uuid, curriculum uuid);
    create table t_ctx(uid uuid, ctx jsonb, denied boolean);
    create function public.qb_is_acceptance_actor() returns boolean language sql stable as $$ select false $$;
    create function public.qb_current_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), '') $$;
    create function public.qb_public_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;
    create function public.qb_is_tenant_member(t uuid) returns boolean language sql stable as $$ select false $$;
    create function public.qb_question_is_available(q public.questions) returns boolean language sql stable as $$ select true $$;
    create function quizbox_market.resolve_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
    declare r record; begin
      select * into r from public.t_ctx where uid = auth.uid();
      if r.uid is null or r.denied then raise exception 'QB_CONTENT_CONTEXT_DENIED' using errcode='42501'; end if;
      return r.ctx; end $$;
    create function quizbox_market.document_owned(p_doc uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.t_owned where uid = auth.uid() and doc = p_doc) $$;
    create function quizbox_market.curriculum_allowed(p_cur uuid, p_ctx jsonb default null) returns boolean language plpgsql stable security definer set search_path='' as $$
    begin return exists(select 1 from public.t_cur where uid = auth.uid() and curriculum = p_cur);
    exception when sqlstate '42501' then return false; end $$;
    create function quizbox_market.node_allowed(p_node uuid, p_ctx jsonb default null) returns boolean language sql stable security definer set search_path='' as $$ select true $$;
    create function quizbox_competition.curriculum_question_allowed(p uuid) returns boolean language sql as $$ select false $$;
    create function quizbox_market.question_allowed(p_question uuid, p_context jsonb default null) returns boolean language plpgsql stable security definer set search_path='' as $$
    declare c jsonb; q public.questions;
    begin
      c := coalesce(p_context, quizbox_market.resolve_context()); select * into q from public.questions where id = p_question;
      if q.id is null then return false; end if;
      if q.source_type = 'DEV_ACCEPTANCE_FIXTURE' and not public.qb_is_acceptance_actor() then return false; end if;
      if q.origin_candidate_id is not null then return auth.uid() = '${USERS.admin}'::uuid; end if;
      if cardinality(q.source_document_ids) > 0 then
        if jsonb_array_length(c->'source_document_ids') = 0 then
          return quizbox_market.curriculum_allowed(q.curriculum_id, c) and not exists(select 1 from unnest(q.source_document_ids) s left join public.source_documents d on d.id = s where d.id is null or d.validation_status <> 'approved' or d.source_kind <> 'CURRICULUM' or d.curriculum_id is distinct from q.curriculum_id or not quizbox_market.document_owned(d.id));
        end if;
        return c->'source_document_ids' @> to_jsonb(q.source_document_ids) and quizbox_market.node_allowed(q.curriculum_node_id, c);
      end if;
      return jsonb_array_length(c->'source_document_ids') = 0 and exists(select 1 from public.legacy_content_attributions l where l.question_id = q.id and l.curriculum_id = q.curriculum_id) and quizbox_market.curriculum_allowed(q.curriculum_id, c);
    exception when sqlstate '42501' then return false;
    end $$;
    -- The rules as they were before the migration.
    alter table public.questions enable row level security;
    create policy market_question_access on public.questions as restrictive for all to authenticated using (quizbox_market.question_allowed(id)) with check (quizbox_market.question_allowed(id));
    create policy questions_admin_all on public.questions for all to authenticated using (public.qb_current_role() = any (array['ADMIN','OWNER'])) with check (public.qb_current_role() = any (array['ADMIN','OWNER']));
    create policy questions_authorized_teacher_read on public.questions for select to authenticated using (upper(public.qb_current_role()) = 'TEACHER' and public.qb_question_is_available(questions) and (tenant_id is null or tenant_id = public.qb_public_tenant_id() or public.qb_is_tenant_member(tenant_id)));
    grant usage on schema public, auth, quizbox_market, quizbox_competition to authenticated;
    grant select on all tables in schema public to authenticated;

    insert into public.source_documents values
      ('${D.ok}','approved','CURRICULUM','${CUR_A}'), ('${D.notOwned}','approved','CURRICULUM','${CUR_A}'), ('${D.pending}','pending','CURRICULUM','${CUR_A}'),
      ('${D.otherCurriculum}','approved','CURRICULUM','${CUR_B}'), ('${D.sponsor}','approved','SPONSOR_SOURCE','${CUR_A}');
    -- plain: default context, may see curriculum A and own ok + pending + otherCurriculum + sponsor documents. withDocs: context names a document. denied: context refused. nothing: default context, no curriculum.
    insert into public.t_ctx values
      ('${USERS.plain}','{"source_document_ids":[]}',false), ('${USERS.withDocs}','{"source_document_ids":["${D.ok}"]}',false),
      ('${USERS.denied}','{"source_document_ids":[]}',true), ('${USERS.nothing}','{"source_document_ids":[]}',false), ('${USERS.admin}','{"source_document_ids":[]}',false);
    insert into public.t_owned select u, d from (values ('${USERS.plain}'::uuid), ('${USERS.withDocs}'), ('${USERS.nothing}'), ('${USERS.admin}')) x(u), (values ('${D.ok}'::uuid), ('${D.pending}'), ('${D.otherCurriculum}'), ('${D.sponsor}')) y(d);
    insert into public.t_cur values ('${USERS.plain}','${CUR_A}'), ('${USERS.withDocs}','${CUR_A}'), ('${USERS.admin}','${CUR_A}');
    -- Every combination of document list, curriculum, origin and source type.
    insert into public.questions(id, origin_candidate_id, curriculum_id, source_document_ids, source_type)
    select gen_random_uuid(), case when o then '${id(900)}'::uuid end, c, l, case when f then 'DEV_ACCEPTANCE_FIXTURE' else 'workbook' end
    from (values ('${CUR_A}'::uuid), ('${CUR_B}'::uuid), (null::uuid)) cs(c),
         (values (array['${D.ok}']::uuid[]), (array['${D.ok}','${D.ok}']::uuid[]), (array['${D.ok}','${D.notOwned}']::uuid[]), (array['${D.pending}']::uuid[]), (array['${D.otherCurriculum}']::uuid[]), (array['${D.sponsor}']::uuid[]),
                 (array['${D.ok}', null]::uuid[]), (array[]::uuid[]), (null::uuid[])) ls(l),
         (values (false), (true)) os(o), (values (false), (true)) fs(f);
    insert into public.legacy_content_attributions select id, curriculum_id from public.questions where cardinality(source_document_ids) = 0 and curriculum_id is not null;
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

const compare = (uid: string) => rows(`select q.id, quizbox_market.question_allowed(q.id) as slow,
  quizbox_market.question_row_allowed(q.id, q.origin_candidate_id, q.curriculum_id, q.source_document_ids, q.source_type, (select quizbox_market.question_doc_pairs())) as fast from public.questions q`);

describe("the once-per-statement market rule agrees with the per-row rule", () => {
  for (const [name, uid] of Object.entries(USERS)) {
    it(`gives the same answer for every question: ${name}`, async () => {
      await as(uid, "");
      const r = await compare(uid);
      expect(r.length).toBe(108);
      expect(r.filter((x) => x.slow !== x.fast)).toEqual([]);
    });
  }
  it("is not vacuous: the plain user sees some questions and is refused others", async () => {
    await as(USERS.plain, "");
    const r = await compare(USERS.plain);
    expect(r.filter((x) => x.fast).length).toBeGreaterThanOrEqual(3); expect(r.filter((x) => !x.fast).length).toBeGreaterThan(50);
  });
  it("a denied context sees nothing and a user without the curriculum sees nothing", async () => {
    for (const uid of [USERS.denied, USERS.nothing]) { await as(uid, ""); expect((await compare(uid)).filter((x) => x.fast)).toEqual([]); }
  });
  it("release fixtures and sponsor candidates still go through the full rule", async () => {
    await as(USERS.plain, "");
    const r = await rows(`select count(*) filter (where quizbox_market.question_row_allowed(q.id, q.origin_candidate_id, q.curriculum_id, q.source_document_ids, q.source_type, (select quizbox_market.question_doc_pairs()))) n from public.questions q where q.source_type = 'DEV_ACCEPTANCE_FIXTURE' or q.origin_candidate_id is not null`);
    expect(Number(r[0].n)).toBe(0);
  });
  it("a missing curriculum or a missing document is refused, never waved through", async () => {
    await as(USERS.plain, "");
    const r = await rows(`select count(*) filter (where quizbox_market.question_row_allowed(q.id, q.origin_candidate_id, q.curriculum_id, q.source_document_ids, q.source_type, (select quizbox_market.question_doc_pairs()))) n from public.questions q where q.curriculum_id is null and cardinality(q.source_document_ids) > 0 or ${"q.source_document_ids @> array[null]::uuid[]"}`);
    expect(Number(r[0].n)).toBe(0);
  });
});

describe("through the table's row-level security", () => {
  const count = async (uid: string, role: string) => { await db.exec("reset role"); await as(uid, role); await db.exec("set role authenticated"); const n = Number((await rows("select count(*) n from public.questions"))[0].n); await db.exec("reset role"); return n; };
  const expected = async (uid: string) => { await as(uid, ""); return Number((await rows("select count(*) n from public.questions q where quizbox_market.question_allowed(q.id)"))[0].n); };
  it("an administrator sees exactly the questions the market rule allows", async () => {
    for (const uid of [USERS.plain, USERS.denied, USERS.nothing, USERS.withDocs]) expect(await count(uid, "ADMIN")).toBe(await expected(uid));
  });
  it("a teacher sees the same set, a student sees none", async () => {
    expect(await count(USERS.plain, "TEACHER")).toBe(await expected(USERS.plain));
    expect(await count(USERS.plain, "STUDENT")).toBe(0);
  });
  it("the role is read once for the statement and the page index exists", async () => {
    const pol = await rows("select policyname, qual from pg_policies where tablename = 'questions' order by policyname");
    expect(pol.find((p) => p.policyname === "questions_admin_all")!.qual).toContain("SELECT qb_current_role");
    expect(pol.find((p) => p.policyname === "market_question_access")!.qual).toContain("question_row_allowed");
    expect((await rows("select 1 from pg_indexes where indexname = 'questions_created_at_idx'")).length).toBe(1);
  });
  it("running the migration again changes nothing", async () => {
    await db.exec(MIGRATION);
    expect(await count(USERS.plain, "ADMIN")).toBe(await expected(USERS.plain));
  });
});

describe("rollback", () => {
  it("puts the original rules back and the same questions stay visible", async () => {
    await db.exec(ROLLBACK);
    const pol = await rows("select policyname, qual from pg_policies where tablename = 'questions' order by policyname");
    expect(pol.find((p) => p.policyname === "market_question_access")!.qual).toContain("question_allowed(id)");
    expect(pol.find((p) => p.policyname === "market_question_access")!.qual).not.toContain("question_row_allowed");
    await db.exec("reset role"); await as(USERS.plain, "ADMIN"); await db.exec("set role authenticated");
    const n = Number((await rows("select count(*) n from public.questions"))[0].n);
    await db.exec("reset role"); await as(USERS.plain, "");
    expect(n).toBe(Number((await rows("select count(*) n from public.questions q where quizbox_market.question_allowed(q.id)"))[0].n));
  });
});
