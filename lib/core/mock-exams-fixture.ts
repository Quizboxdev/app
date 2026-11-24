import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect } from "vitest";

// Shared test database for the three mock-exam migrations. Isolated PostgreSQL (PGlite). The curriculum, question, class and attempt tables are stand-ins; the two topic helpers the picker depends on
// (quizbox_topic.listable_questions, quizbox_topic.pick_for_topic) and the class-level function are the REAL functions, cut from the assessment-blueprint migration, and the Marketplace is the REAL
// marketplace migration (payments and the coin ledger are stubbed because they have their own tests). The class publisher, attempt engine and snapshot trigger are stubs, so the integration
// with the real engine is NOT proven here (see docs/mock-exams/HANDOFF.md).
export const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const MIG = {
  get authoring() { return read("supabase/migrations/20261122100000_mock_exams_authoring.sql"); }, get delivery() { return read("supabase/migrations/20261122110000_mock_exams_delivery.sql"); },
  get marketplaceMock() { return read("supabase/migrations/20261122120000_mock_exams_marketplace.sql"); }, get sponsorMock() { return read("supabase/migrations/20261124130000_mock_exams_sponsor_delivery.sql"); }, get marketplace() { return read("supabase/migrations/20261043100000_marketplace.sql"); },
};
const BLUEPRINT = read("supabase/migrations/20261055100000_assessment_blueprint.sql");
const cut = (sql: string, from: string) => { const a = sql.indexOf(from), open = sql.indexOf("$fn$", a), close = sql.indexOf("$fn$;", open + 4); return sql.slice(a, close + 5); };
const REAL_TOPIC_FUNCS = ["quizbox_topic.listable_questions(", "quizbox_topic.pick_for_topic(", "quizbox_topic.class_level("].map((f) => cut(BLUEPRINT, `create or replace function ${f}`)).join("\n");

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const U = { TEACHER: id(1), TEACHER2: id(2), STUDENT: id(3), SPONSOR_OK: id(4), SPONSOR_NEW: id(5), SPONSOR_IND: id(6), OWNER: id(7), DORMANT: id(8), STUDENT2: id(9), STUDENT3: id(10), BUYER: id(11), BUYER2: id(12),
  MINOR: id(13), TEACHER_BUYER: id(14), FINANCE: id(15), SPONSOR_ALUMNI: id(16), SPONSOR_PARENT: id(17), KID: id(18), KID2: id(19), KID_NO_ASSIGN: id(20), JOINER1: id(21), JOINER2: id(22), JOINER3: id(23), MANAGED: id(24) };
export const CUR = id(100), MARKET = id(101), PUBLIC_TENANT = id(102), OTHER_CUR = id(103), OTHER_MARKET = id(104);
export const TOPIC = { FRAC: id(200), ALG: id(201), CELLS: id(202), GEO: id(203), FEW: id(204), SHS_ALG: id(205) };

export type Ctx = Awaited<ReturnType<typeof makeCtx>>;

export async function makeCtx(until: "authoring" | "delivery" | "marketplace" | "sponsor" = "authoring") {
  const market = until === "marketplace" || until === "sponsor";
  const db = new PGlite();
  let qn = 0, nIntent = 0;
  const as = async (user: string | null) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec(user ? "set role authenticated" : "set role anon"); };
  const reset = async () => { await db.exec("reset role"); };
  const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
  const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
  const q = async <T extends Record<string, any>>(sql: string, params: unknown[] = []) => { await reset(); return (await db.query<T>(sql, params)).rows; };
  const setFlag = async (key: string, on: boolean) => { await reset(); await db.query("update public.platform_settings set value = $2::jsonb where key = $1", [key, JSON.stringify(on)]); };

  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text, default_market_id uuid);
    create table public.sponsor_profiles(user_id uuid primary key, sponsor_type text, verification_status text, status text default 'active');
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, is_minor boolean not null default false, managed_by uuid);
    create table public.family_workspaces(id uuid primary key default gen_random_uuid(), owner_user_id uuid not null unique, name text not null default 'My family');
    create table public.account_relationships(id uuid primary key default gen_random_uuid(), source_user_id uuid not null, target_user_id uuid not null, status text not null default 'active', family_workspace_id uuid, valid_from timestamptz not null default now(), valid_until timestamptz, consent_status text not null default 'granted', permissions jsonb not null default '{}');
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.platform_settings(id uuid primary key default gen_random_uuid(), key text not null, scope_type text not null default 'global', scope_id uuid, value jsonb not null, description text not null default '');
    create unique index platform_settings_scope_key on public.platform_settings(key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text not null, type text not null, title text not null, message text not null,
      created_at timestamptz not null default now(), read_at timestamptz, link text, category text not null default 'system');
    create schema quizbox_core;
    create function quizbox_core.setting(p_key text) returns jsonb language sql stable as $$ select value from public.platform_settings where key = p_key and scope_type = 'global' $$;
    create function quizbox_core.flag(p_key text) returns boolean language sql stable as $$ select coalesce(quizbox_core.setting(p_key) = 'true'::jsonb, false) $$;
    create function quizbox_core.is_staff(p_roles text[] default array['super_admin']) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and (exists(select 1 from public.profiles where id = auth.uid() and lower(role) = 'owner') or exists(select 1 from public.user_capabilities where user_id = auth.uid() and active and capability = any(p_roles))) $$;
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql security definer as $$
      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, p_entity_type, p_entity, 'pass', p_details) $$;
    grant usage on schema quizbox_core to anon, authenticated, service_role; grant execute on all functions in schema quizbox_core to anon, authenticated, service_role;
    create table public.curricula(id uuid primary key, code text, name text, version text, status text default 'ACTIVE');
    create table public.market_curricula(curriculum_id uuid primary key, market_id uuid not null, active boolean not null default true);
    create table public.curriculum_nodes(id uuid primary key default gen_random_uuid(), curriculum_id uuid, parent_id uuid, node_type text, code text, title text, subject_code text, grade_code text, canonical_grade_code text, sort_order int default 0);
    create table public.curriculum_topics(id uuid primary key, curriculum_id uuid not null, indicator_node_id uuid not null, title text not null, sort_order int default 0, status text not null default 'ACTIVE');
    create table public.questions(id uuid primary key, question_text text not null, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text, answer_type text, answer_spec jsonb, question_content jsonb,
      marks numeric(8,2) not null default 1, version integer not null default 1, status text not null default 'active', validation_status text, tenant_id uuid, curriculum_node_id uuid, external_question_id text, source_type text, source_version text,
      curriculum_reference text, text_hash text, duplicate_group_id text, difficulty_code text, difficulty_label text);
    create table public.question_topic_links(question_id uuid primary key references public.questions(id), topic_id uuid not null, concept_id uuid);
    create function public.qb_public_tenant_id() returns uuid language sql stable as $$ select '${PUBLIC_TENANT}'::uuid $$;
    create function public.qb_question_is_listable(q public.questions) returns boolean language sql stable as $$ select q.status = 'active' and q.validation_status = 'approved' and q.tenant_id is null $$;
    create function public.qb_question_is_available(q public.questions) returns boolean language sql stable as $$ select q.status = 'active' and q.validation_status = 'approved' $$;
    create schema quizbox_topic;
    create function quizbox_topic.ancestor_title(p_node uuid, p_type text) returns text language sql stable as $$ select 'Strand of ' || p_type $$;
    ${REAL_TOPIC_FUNCS}
    create type public.qb_status as enum ('active', 'inactive', 'archived'); create type public.attempt_status as enum ('in_progress', 'submitted', 'expired');
    create table public.classes(id uuid primary key default gen_random_uuid(), class_name text, grade text, grade_code text, grade_label text, education_level text, teacher_user_id uuid, status public.qb_status default 'active', curriculum_id uuid);
    create table public.class_memberships(id uuid primary key default gen_random_uuid(), class_id uuid, student_user_id uuid, status public.qb_status default 'active');
    create table public.assessments(id uuid primary key default gen_random_uuid(), assessment_type text, owner_role text, owner_user_id uuid, subject_code text, subject_name text, grade text, grade_code text, question_count int, difficulty text,
      time_limit_minutes int, max_attempts int, allow_resume boolean, auto_submit boolean, pass_percent numeric, opens_at timestamptz, expires_at timestamptz, instructions text, tenant_id uuid, reference_type text, reference_id uuid);
    create table public.assessment_questions(id uuid primary key default gen_random_uuid(), assessment_id uuid, question_id uuid, question_order int, question_text_snapshot text, option_a_snapshot text, option_b_snapshot text, option_c_snapshot text, option_d_snapshot text,
      correct_answer_snapshot text, marks_snapshot numeric, question_content_snapshot jsonb, answer_type_snapshot text, answer_spec_snapshot jsonb);
    create table public.assignments(id uuid primary key default gen_random_uuid(), assessment_id uuid, class_id uuid, teacher_user_id uuid, title text, status text default 'published', due_at timestamptz, question_count int);
    create table public.assignment_targets(id uuid primary key default gen_random_uuid(), assignment_id uuid, class_id uuid, student_id uuid, membership_id uuid, status public.qb_status default 'active');
    create table public.attempts(id uuid primary key default gen_random_uuid(), assignment_id uuid, assessment_id uuid, class_id uuid, student_user_id uuid, started_at timestamptz not null default now(), submitted_at timestamptz,
      score numeric, total_marks numeric, percentage numeric, status public.attempt_status not null default 'in_progress');
    create table public.responses(id uuid primary key default gen_random_uuid(), attempt_id uuid, question_id uuid, selected_answer text, selected_value jsonb, is_correct boolean, marks_awarded numeric not null default 0);
    create function public.qb_can_manage_class(p uuid) returns boolean language sql stable security definer as $$ select exists (select 1 from public.classes where id = p and teacher_user_id = auth.uid()) $$;
    -- Stand-in for the real publisher: it copies the chosen questions the way the real one does (approved, in the named nodes, the exact count) and raises the same error when they are not all available.
    create function public.qb_publish_assignment(p_class_id uuid, p_title text, p_description text, p_curriculum_node_ids uuid[], p_question_count integer, p_difficulty text default null, p_selection_mode text default 'AUTOMATIC',
      p_question_ids uuid[] default null, p_mode text default 'ASSESSMENT', p_attempts_allowed integer default 1, p_time_limit_minutes integer default 30, p_start_at timestamptz default now(), p_due_at timestamptz default null,
      p_target_student_ids uuid[] default null, p_rem uuid default null, p_rem2 uuid default null) returns jsonb language plpgsql security definer as $$
    declare c public.classes; a public.assessments; x public.assignments; n integer;
    begin
      select * into c from public.classes where id = p_class_id;
      select count(*) into n from public.questions q where q.status = 'active' and q.validation_status = 'approved' and q.curriculum_node_id = any (p_curriculum_node_ids) and q.id = any (p_question_ids);
      if n < p_question_count then raise exception 'INSUFFICIENT_APPROVED_QUESTIONS:%/%', n, p_question_count; end if;
      insert into public.assessments(assessment_type, owner_role, owner_user_id, question_count, time_limit_minutes, max_attempts, opens_at, expires_at, instructions, tenant_id, reference_type)
      values (upper(p_mode), 'teacher', auth.uid(), p_question_count, p_time_limit_minutes, p_attempts_allowed, p_start_at, p_due_at, p_description, '${PUBLIC_TENANT}', 'ASSIGNMENT') returning * into a;
      insert into public.assignments(assessment_id, class_id, teacher_user_id, title, due_at, question_count) values (a.id, c.id, auth.uid(), p_title, p_due_at, p_question_count) returning * into x;
      insert into public.assessment_questions(assessment_id, question_id, question_order, question_text_snapshot, correct_answer_snapshot)
        select a.id, q.id, row_number() over (order by q.id), q.question_text, q.correct_answer from public.questions q where q.id = any (p_question_ids);
      insert into public.assignment_targets(assignment_id, class_id, student_id, membership_id) select x.id, c.id, m.student_user_id, m.id from public.class_memberships m
        where m.class_id = c.id and m.status = 'active' and (p_target_student_ids is null or m.student_user_id = any (p_target_student_ids));
      return jsonb_build_object('assignment_id', x.id, 'assessment_id', a.id, 'question_count', p_question_count, 'status', 'PUBLISHED');
    end $$;
    insert into public.profiles values ('${U.TEACHER}','TEACHER','active','Ama Teacher','t@example.com','${MARKET}'),('${U.TEACHER2}','TEACHER','active','Kojo Teacher','t2@example.com','${MARKET}'),
      ('${U.STUDENT}','STUDENT','active','Esi Student','s@example.com','${MARKET}'),('${U.STUDENT2}','STUDENT','active','Kwame Student','s2@example.com','${MARKET}'),('${U.STUDENT3}','STUDENT','active','Abena Student','s3@example.com','${MARKET}'),
      ('${U.SPONSOR_OK}','SPONSOR','active','Org Sponsor','o@example.com','${MARKET}'),('${U.SPONSOR_NEW}','SPONSOR','active','New Sponsor','n@example.com','${MARKET}'),('${U.SPONSOR_IND}','SPONSOR','active','Individual','i@example.com','${MARKET}'),
      ('${U.OWNER}','OWNER','active','Owner','ow@example.com','${MARKET}'),('${U.DORMANT}','TEACHER','inactive','Dormant','d@example.com','${MARKET}'),
      ('${U.BUYER}','STUDENT','active','Yaw Buyer','b1@example.com','${MARKET}'),('${U.BUYER2}','STUDENT','active','Akua Buyer','b2@example.com','${MARKET}'),('${U.MINOR}','STUDENT','active','Little One','m@example.com','${MARKET}'),
      ('${U.TEACHER_BUYER}','TEACHER','active','Teacher Buyer','tb@example.com','${MARKET}'),('${U.FINANCE}','ADMIN','active','Finance','f@example.com','${MARKET}'),
      ('${U.SPONSOR_ALUMNI}','SPONSOR','active','Old Students Association','al@example.com','${MARKET}'),('${U.SPONSOR_PARENT}','SPONSOR','active','Mrs Parent','pa@example.com','${MARKET}'),
      ('${U.KID}','STUDENT','active','Kofi Child','k1@example.com','${MARKET}'),('${U.KID2}','STUDENT','active','Ama Child','k2@example.com','${MARKET}'),('${U.KID_NO_ASSIGN}','STUDENT','active','Sponsored Child','k3@example.com','${MARKET}'),
      ('${U.JOINER1}','STUDENT','active','Joiner One','j1@example.com','${MARKET}'),('${U.JOINER2}','STUDENT','active','Joiner Two','j2@example.com','${MARKET}'),('${U.JOINER3}','STUDENT','active','Joiner Three','j3@example.com','${MARKET}'),('${U.MANAGED}','STUDENT','active','Managed Child','mg@example.com','${MARKET}');
    insert into public.student_profiles(user_id, is_minor) values ('${U.STUDENT}', false),('${U.STUDENT2}', false),('${U.STUDENT3}', false),('${U.BUYER}', false),('${U.BUYER2}', false),('${U.MINOR}', true),('${U.KID}', false),('${U.KID2}', false),('${U.KID_NO_ASSIGN}', false),('${U.JOINER1}', false),('${U.JOINER2}', false),('${U.JOINER3}', false);
    insert into public.student_profiles(user_id, is_minor, managed_by) values ('${U.MANAGED}', true, '${U.SPONSOR_PARENT}');
    insert into public.user_capabilities values ('${U.FINANCE}', 'finance_admin', true);
    insert into public.sponsor_profiles values ('${U.SPONSOR_OK}','ORGANIZATION','VERIFIED','active'),('${U.SPONSOR_NEW}','ORGANIZATION','PENDING','active'),('${U.SPONSOR_IND}','INDIVIDUAL','VERIFIED','active'),('${U.SPONSOR_ALUMNI}','ALUMNI','VERIFIED','active'),('${U.SPONSOR_PARENT}','INDIVIDUAL','VERIFIED','active');
    insert into public.family_workspaces(id, owner_user_id) values ('${id(300)}', '${U.SPONSOR_PARENT}');
    insert into public.account_relationships(source_user_id, target_user_id, family_workspace_id, permissions) values ('${U.SPONSOR_PARENT}', '${U.KID}', '${id(300)}', '{"assign": true}'), ('${U.SPONSOR_PARENT}', '${U.KID2}', '${id(300)}', '{"assign": true}'), ('${U.SPONSOR_PARENT}', '${U.KID_NO_ASSIGN}', '${id(300)}', '{"view_progress": true}');
    insert into public.curricula values ('${CUR}','GH-SBC','Ghana Standards-Based Curriculum','2019','ACTIVE'),('${OTHER_CUR}','OTHER','Other curriculum','1','ACTIVE');
    insert into public.market_curricula values ('${CUR}','${MARKET}',true),('${OTHER_CUR}','${OTHER_MARKET}',true);
  `);
  if (market) {
    await db.exec(`
      create table public.payment_intents(id uuid primary key default gen_random_uuid(), reference text not null unique, beneficiary_user_id uuid not null, amount_minor bigint not null, coins bigint not null,
        status text not null default 'initiated', credited_tx_id uuid, metadata jsonb not null default '{}');
      create table public.stub_wallet(user_id uuid primary key, balance bigint not null default 0); create table public.stub_spend(idem text primary key, user_id uuid, amount bigint);
      create function public.qb_coin_spend(p_user uuid, p_amount bigint, p_purpose text, p_ref text, p_idem text, p_entitlement jsonb default null) returns jsonb language plpgsql security definer as $$
        begin
          if exists (select 1 from public.stub_spend where idem = p_idem) then return jsonb_build_object('spent', p_amount, 'duplicate', true); end if;
          update public.stub_wallet set balance = balance - p_amount where user_id = p_user and balance >= p_amount;
          if not found then raise exception 'QB_INSUFFICIENT_BALANCE'; end if;
          insert into public.stub_spend values (p_idem, p_user, p_amount); return jsonb_build_object('spent', p_amount);
        end $$;
    `);
    await db.exec(MIG.marketplace);
  }
  await db.exec(MIG.authoring);
  if (until !== "authoring") await db.exec(MIG.delivery);
  if (market) await db.exec(MIG.marketplaceMock);
  if (until === "sponsor") {
    await db.exec(`
      create function quizbox_core.family_can(p_parent uuid, p_student uuid, p_perm text) returns boolean language sql stable as $$
        select p_parent is not null and exists (select 1 from public.account_relationships r where r.source_user_id = p_parent and r.target_user_id = p_student and r.family_workspace_id is not null and r.status = 'active'
          and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now()) and r.consent_status in ('granted', 'not_required') and coalesce((r.permissions ->> p_perm)::boolean, false)) $$;
      create function public.qb_challenge_active_user() returns boolean language sql stable security definer as $$
        select auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status) = 'active') and not exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.managed_by is not null) $$;
      insert into public.platform_settings(key, value, description) values ('flags.family_workspace', 'true', 'Family workspace');
    `);
    await db.exec(MIG.sponsorMock);
    await db.query("insert into public.stub_wallet values ($1, 5000), ($2, 5000), ($3, 3) on conflict (user_id) do update set balance = excluded.balance", [U.SPONSOR_OK, U.SPONSOR_ALUMNI, U.SPONSOR_PARENT]);
  }
  await setFlag("flags.mock_exams", true);
  if (market) await setFlag("flags.marketplace", true);
  if (until === "sponsor") await setFlag("flags.mock_exam_links", true);

  // Curriculum nodes: a subject node per level, an indicator node per topic.
  for (const [g, s, t] of [["B7", "MATH", "Mathematics"], ["B8", "MATH", "Mathematics"], ["B8", "SCI", "Integrated Science"], ["B9", "MATH", "Mathematics"], ["SHS1", "MATH", "Core Mathematics"], ["SHS2", "MATH", "Core Mathematics"]])
    await db.query("insert into public.curriculum_nodes(curriculum_id, node_type, title, subject_code, grade_code, canonical_grade_code) values ($1,'subject',$2,$3,$4,$4)", [CUR, t, s, g]);
  const nodes: Record<string, string> = {};
  const topics: Array<[string, string, string, string, string]> = [
    [TOPIC.FRAC, "B7", "MATH", "B7.1.1", "Fractions and decimals"], [TOPIC.ALG, "B8", "MATH", "B8.2.1", "Algebraic expressions"], [TOPIC.CELLS, "B8", "SCI", "B8.3.1", "Cells and organisms"],
    [TOPIC.GEO, "B9", "MATH", "B9.1.1", "Geometry and mensuration"], [TOPIC.FEW, "B8", "MATH", "B8.2.9", "Thin topic"], [TOPIC.SHS_ALG, "SHS1", "MATH", "S1.1.1", "SHS algebra"],
  ];
  for (const [tid, g, s, code, title] of topics) {
    nodes[tid] = (await db.query<{ id: string }>("insert into public.curriculum_nodes(curriculum_id, node_type, title, code, subject_code, grade_code, canonical_grade_code) values ($1,'learning_indicator','Indicator',$2,$3,$4,$4) returning id", [CUR, code, s, g])).rows[0].id;
    await db.query("insert into public.curriculum_topics(id, curriculum_id, indicator_node_id, title) values ($1,$2,$3,$4)", [tid, CUR, nodes[tid], title]);
  }

  const addQuestions = async (topic: string, n: number, tag: string, opts: { hash?: string; dupGroup?: string; answerType?: string; spec?: unknown } = {}) => {
    await reset();
    const node = (await db.query<{ n: string }>("select indicator_node_id as n from public.curriculum_topics where id = $1", [topic])).rows[0].n, ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const qid = id(10_000 + ++qn), level = ["easy", "medium", "hard"][i % 3];
      await db.query(`insert into public.questions(id, question_text, option_a, option_b, option_c, option_d, correct_answer, answer_type, answer_spec, marks, version, status, validation_status, curriculum_node_id, difficulty_label, text_hash, duplicate_group_id, external_question_id)
        values ($1, $2, 'one', 'two', 'three', 'four', 'A', $8, $9::jsonb, 1, 1, 'active', 'approved', $3, $4, $5, $6, $7)`,
        [qid, `${tag} question ${i + 1} about the topic?`, node, level, opts.hash && i === 0 ? opts.hash : `h-${qid}`, opts.dupGroup && i === 0 ? opts.dupGroup : null, `EXT-${qn}`, opts.answerType ?? "SINGLE_CHOICE", opts.spec ? JSON.stringify(opts.spec) : null]);
      await db.query("insert into public.question_topic_links(question_id, topic_id) values ($1, $2)", [qid, topic]);
      ids.push(qid);
    }
    return ids;
  };
  await addQuestions(TOPIC.FRAC, 9, "Fractions"); await addQuestions(TOPIC.ALG, 9, "Algebra"); await addQuestions(TOPIC.CELLS, 6, "Cells"); await addQuestions(TOPIC.GEO, 6, "Geometry"); await addQuestions(TOPIC.FEW, 2, "Thin");

  const exam = async (u: string, over: Record<string, unknown> = {}) => { await as(u); return rpc("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "JHS 2 BECE readiness mock", purpose: "bece_readiness", curriculum_id: CUR, target_grade: "B8", desired_total: 12, ...over })]); };
  const round = (e: string, grade: string, subject: string, topic: string, n: number, existing: string | null = null) => rpc("select public.qb_mock_round_save($1,$2,$3,$4,$5,$6)", [e, existing, grade, subject, topic, n]);
  // A fully built 6-question exam: 3 from Fractions (B7), 3 from Algebra (B8).
  const readyExam = async (u = U.TEACHER, over: Record<string, unknown> = {}) => {
    const e = await exam(u, { desired_total: 6, ...over });
    const r1 = (await round(e.id, "B7", "MATH", TOPIC.FRAC, 3)).rounds[0], r2 = (await round(e.id, "B8", "MATH", TOPIC.ALG, 3)).rounds[1];
    await rpc("select public.qb_mock_round_pick($1,$2)", [e.id, r1.id]); await rpc("select public.qb_mock_round_pick($1,$2)", [e.id, r2.id]);
    return e.id as string;
  };
  const publish = async (examId: string) => rpc("select public.qb_mock_exam_publish($1)", [examId]);
  const publishedExam = async (u = U.TEACHER, over: Record<string, unknown> = {}) => { const eid = await readyExam(u, over); await as(u); const p = await publish(eid); return { id: eid, versionId: p.version_id as string, versionNo: p.version_no as number }; };

  // A class of active learners, at a given level.
  const makeClass = async (teacher: string, students: string[], over: { name?: string; grade?: string; level?: string } = {}) => {
    await reset();
    const grade = over.grade ?? "B8";
    const c = (await db.query<{ id: string }>("insert into public.classes(class_name, grade, grade_code, grade_label, education_level, teacher_user_id, curriculum_id) values ($1,$2,$2,$2,$3,$4,$5) returning id",
      [over.name ?? "JHS 2 Gold", grade, over.level ?? "JHS", teacher, CUR])).rows[0].id;
    for (const s of students) await db.query("insert into public.class_memberships(class_id, student_user_id) values ($1,$2)", [c, s]);
    return c as string;
  };
  // Simulates a learner's attempt on an assessment: answers is a map question id -> { letter or value, correct }.
  const attempt = async (a: { assessmentId: string; assignmentId?: string | null; classId?: string | null; student: string; answers: Array<{ question_id: string; selected_answer?: string | null; selected_value?: unknown; is_correct: boolean }>; status?: string; startedAt?: string }) => {
    await reset();
    const marks = a.answers.filter((x) => x.is_correct).length, total = (await db.query<{ n: number }>("select count(*)::int as n from public.assessment_questions where assessment_id = $1", [a.assessmentId])).rows[0].n;
    const status = a.status ?? "submitted";
    const done = status !== "in_progress", pct = total > 0 ? Math.round((10000 * marks) / total) / 100 : 0;
    const att = (await db.query<{ id: string }>("insert into public.attempts(assignment_id, assessment_id, class_id, student_user_id, started_at, submitted_at, score, total_marks, percentage, status) values ($1,$2,$3,$4, coalesce($5::timestamptz, now()), $6::timestamptz, $7::numeric, $8::numeric, $9::numeric, $10::public.attempt_status) returning id",
      [a.assignmentId ?? null, a.assessmentId, a.classId ?? null, a.student, a.startedAt ?? null, done ? new Date().toISOString() : null, done ? marks : null, total, done ? pct : null, status])).rows[0].id;
    for (const r of a.answers) await db.query("insert into public.responses(attempt_id, question_id, selected_answer, selected_value, is_correct, marks_awarded) values ($1,$2,$3,$4::jsonb,$5,$6)",
      [att, r.question_id, r.selected_answer ?? null, r.selected_value === undefined ? null : JSON.stringify(r.selected_value), r.is_correct, r.is_correct ? 1 : 0]);
    return att as string;
  };

  // Marketplace helpers (until === "marketplace"): a verified teacher seller, and a paid purchase through the real payment steps (the payment provider itself is not involved).
  const seller = async (u: string, name = "Ama Mensah", school = "Opoku Ware School") => { await as(u); return rpc("select public.qb_mk_seller_save($1,$2,'0244000000','mobile_money','MTN','0244000000',$3,true)", [name, school, name]); };
  const verifySeller = async (u: string) => { await seller(u); await as(U.OWNER); const list = await rpc("select public.qb_mk_admin_sellers('pending')"); const mine = list.find((x: any) => x.email === (u === U.TEACHER ? "t@example.com" : u === U.SPONSOR_OK ? "o@example.com" : "t2@example.com")); await rpc("select public.qb_mk_admin_seller_set($1,'verified','')", [mine.id]); };
  const pay = async (buyer: string, item: { id: string }, price: number) => {
    const ref = `QB-mock${++nIntent}`;
    await reset();
    await db.query("insert into public.payment_intents(reference, beneficiary_user_id, amount_minor, coins) values ($1,$2,$3,$4)", [ref, buyer, price, price / 100]);
    await db.query("insert into public.stub_wallet values ($1,$2) on conflict (user_id) do update set balance = public.stub_wallet.balance + excluded.balance", [buyer, price / 100]);
    await db.query("select public.qb_mk_set_payment_item($1,$2,$3)", [ref, item.id, price]);
    await db.query("update public.payment_intents set status='successful', credited_tx_id=gen_random_uuid() where reference=$1", [ref]);
    return { ref, out: await rpc("select public.qb_mk_fulfil_purchase($1)", [ref]) };
  };

  return { db, as, reset, rpc, fails, q, setFlag, addQuestions, exam, round, readyExam, publish, publishedExam, makeClass, attempt, seller, verifySeller, pay, nodes, close: () => db.close() };
}
