-- December 2026 release-readiness gate. PART 1: harness and synthetic world.
-- Everything runs inside ONE transaction that ends in ROLLBACK, so nothing is ever kept (Preview or scratch).
-- Synthetic data only: e2e.quizbox.invalid addresses, fixed 'dec-gate' identifiers, no real school, teacher, guardian or learner.
-- Real database code paths only: every check calls the real RPCs / tables as the `authenticated` or `anon` role with a real JWT claim, so RLS and grants apply.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset pager off
begin;
create temp table gate_results(n serial primary key, area text, id text, test text, expected text, status text, detail text);
create temp table gate_ids(name text primary key, id uuid);
grant all on gate_ids, gate_results to public;   -- readable while a browser role is active (temp tables are session-local)
grant usage, select on sequence gate_results_n_seq to public;

create function pg_temp.gid(p_name text) returns uuid language sql stable as $$ select id from gate_ids where name = p_name $$;
create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
end $$;
-- qb_publish_assignment keeps a temp table until the end of ITS transaction; the gate runs many publishes in one transaction, so it is cleared between calls.
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; execute 'drop table if exists pg_temp.qb_selected_questions'; end $$;
-- A count that treats "permission denied" as "sees nothing" (both mean the browser role cannot read the rows).
create function pg_temp.cnt(p text) returns bigint language plpgsql as $$ declare n bigint; begin execute p into n; return n; exception when insufficient_privilege then return 0; end $$;
-- status: PASS, FAIL (a defect), BLOCKED (the check could not run, with the reason)
create function pg_temp.rec(p_area text, p_id text, p_test text, p_expected text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into gate_results(area, id, test, expected, status, detail) values (p_area, p_id, p_test, p_expected, case when p_ok then 'PASS' else 'FAIL' end, p_detail) $$;
create function pg_temp.blocked(p_area text, p_id text, p_test text, p_why text) returns void language sql as $$
  insert into gate_results(area, id, test, expected, status, detail) values (p_area, p_id, p_test, '', 'BLOCKED', p_why) $$;

-- ---- Synthetic world -------------------------------------------------------------------------------------------------------------------
insert into gate_ids(name, id) values
 ('market','d0a70000-0000-4000-8000-000000000001'),('authority','d0a70000-0000-4000-8000-000000000002'),('curriculum','d0a70000-0000-4000-8000-000000000003'),
 ('node','d0a70000-0000-4000-8000-000000000004'),('node_other','d0a70000-0000-4000-8000-000000000005'),('document','d0a70000-0000-4000-8000-000000000006'),
 ('tpA','d0a70000-0000-4000-8000-000000000011'),('tpB','d0a70000-0000-4000-8000-000000000012'),
 ('classA','d0a70000-0000-4000-8000-000000000021'),('classB','d0a70000-0000-4000-8000-000000000022'),('classOld','d0a70000-0000-4000-8000-000000000023'),
 ('teacherA','d0a70000-0000-4000-8000-0000000000a1'),('teacherB','d0a70000-0000-4000-8000-0000000000a2'),
 ('s1','d0a70000-0000-4000-8000-0000000000b1'),('s2','d0a70000-0000-4000-8000-0000000000b2'),('s3','d0a70000-0000-4000-8000-0000000000b3'),('s4','d0a70000-0000-4000-8000-0000000000b4'),('sMinor','d0a70000-0000-4000-8000-0000000000b5'),
 ('parentP','d0a70000-0000-4000-8000-0000000000c1'),('parentQ','d0a70000-0000-4000-8000-0000000000c2'),('sponsorS','d0a70000-0000-4000-8000-0000000000c3'),
 ('admin','d0a70000-0000-4000-8000-0000000000d1');

-- A reference country is only added when the database has none (a bare scratch database); Preview and Production already have countries.
insert into public.currencies(code,name,symbol,decimal_places) select 'XTS','Test currency','T',2 where not exists (select 1 from public.countries) and exists (select 1 from information_schema.tables where table_schema='public' and table_name='currencies') on conflict do nothing;
insert into public.countries(iso2_code,iso3_code,name,default_currency_code,timezone,locale,active) select 'XT','XTT','Testland','XTS','UTC','en',true where not exists (select 1 from public.countries);
-- One market, one authority, one curriculum, two indicator nodes (same shape as lib/operations/live-fixture.ts)
insert into public.markets(id,country_id,name,default_currency_code,timezone,locale,status,is_test)
  select pg_temp.gid('market'), c.id, 'DECGATE-market', c.default_currency_code, c.timezone, c.locale, 'ACTIVE', true from public.countries c order by (c.iso2_code='XT') desc, c.iso2_code limit 1;
insert into public.curriculum_authorities(id,market_id,code,name) values (pg_temp.gid('authority'), pg_temp.gid('market'), 'DECGATEAUTH', 'DECGATE authority');
insert into public.curricula(id,code,name,country,version,market_id,status) values (pg_temp.gid('curriculum'), 'DECGATE-market', 'DECGATE curriculum', 'Testland', '1', pg_temp.gid('market'), 'ACTIVE');
insert into public.curriculum_nodes(id,curriculum_id,node_type,code,identity_key,title,source_terminology,education_level,grade_code,source_grade_code,canonical_grade_code,subject_code,is_active) values
  (pg_temp.gid('node'), pg_temp.gid('curriculum'), 'learning_indicator', 'DECGATE-LI1', 'DECGATE-LI1', 'Add and subtract within 20', 'learning indicator', 'JHS', 'B7', 'B7', 'B7', 'Mathematics', true),
  (pg_temp.gid('node_other'), pg_temp.gid('curriculum'), 'learning_indicator', 'DECGATE-LI2', 'DECGATE-LI2', 'Fractions of a whole', 'learning indicator', 'JHS', 'B7', 'B7', 'B7', 'Mathematics', true);
insert into public.market_curricula(curriculum_id,market_id,authority_id,active) values (pg_temp.gid('curriculum'), pg_temp.gid('market'), pg_temp.gid('authority'), true);

-- Users (auth + profile + role), all synthetic
insert into auth.users(id,email,raw_user_meta_data)
  select id, 'dec-gate-' || name || '@e2e.quizbox.invalid', jsonb_build_object('full_name','Gate ' || name, 'grade', 'B7') from gate_ids where name in ('teacherA','teacherB','s1','s2','s3','s4','sMinor','parentP','parentQ','sponsorS','admin');
insert into public.profiles(id,role,full_name,email,status,default_market_id,primary_market_id,onboarding_completed_at)
  select g.id, (case when g.name like 'teacher%' then 'teacher' when g.name like 's_' or g.name='sMinor' then 'student' when g.name like 'parent%' then 'parent' when g.name='sponsorS' then 'sponsor' else 'admin' end)::public.qb_role,
         'Gate ' || g.name, 'dec-gate-' || g.name || '@e2e.quizbox.invalid', 'active', pg_temp.gid('market'), pg_temp.gid('market'), now()
  from gate_ids g where g.name in ('teacherA','teacherB','s1','s2','s3','s4','sMinor','parentP','parentQ','sponsorS','admin')
  on conflict (id) do update set role = excluded.role, default_market_id = excluded.default_market_id, primary_market_id = excluded.primary_market_id, onboarding_completed_at = excluded.onboarding_completed_at, status = excluded.status;
-- The signup trigger (Preview and Production) gives every new account a learner profile; only learners keep it.
delete from public.student_profiles where user_id in (select id from gate_ids where name in ('teacherA','teacherB','parentP','parentQ','sponsorS','admin'));
insert into public.user_market_memberships(user_id,market_id,active) select id, pg_temp.gid('market'), true from gate_ids where name in ('teacherA','teacherB','s1','s2','s3','s4','sMinor','parentP','parentQ','sponsorS','admin');
insert into public.teacher_profiles(id,user_id,school_name) values (pg_temp.gid('tpA'), pg_temp.gid('teacherA'), 'DECGATE school A'), (pg_temp.gid('tpB'), pg_temp.gid('teacherB'), 'DECGATE school B');
insert into public.student_profiles(user_id,grade_code,school_name,status)
  select id, 'B7', 'DECGATE school', 'active' from gate_ids where name in ('s1','s2','s3','s4')
  on conflict (user_id) do update set grade_code = 'B7', status = 'active';
-- A self-registered minor (not managed) and the guardian-managed flag are set up by the age tests.
insert into public.student_profiles(user_id,grade_code,school_name,status,is_minor)
  values (pg_temp.gid('sMinor'), 'B7', 'DECGATE school', 'active', true)
  on conflict (user_id) do update set grade_code = 'B7', is_minor = true, status = 'active';

-- Approved curriculum source, two classes (A: teacher A; B: teacher B) and one expired class
insert into public.source_documents(id,title,source_kind,validation_status,rights_confirmed,checksum,content_text,approved_by,uploaded_by,market_id,curriculum_id,authority_id,document_type)
  values (pg_temp.gid('document'), 'DECGATE source', 'CURRICULUM', 'approved', true, 'decgate0001', 'Synthetic curriculum source for the December gate', pg_temp.gid('teacherA'), pg_temp.gid('teacherA'), pg_temp.gid('market'), pg_temp.gid('curriculum'), pg_temp.gid('authority'), 'CURRICULUM');
insert into public.classes(id,join_code,class_name,school_name,grade_label,grade_code,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status,academic_year,term) values
  (pg_temp.gid('classA'), 'QB07-DECGATEAAAA', 'DECGATE class A', 'DECGATE school A', 'Basic 7', 'B7', pg_temp.gid('tpA'), pg_temp.gid('teacherA'), pg_temp.gid('tpA'), pg_temp.gid('curriculum'), 'active', '2026', '1'),
  (pg_temp.gid('classB'), 'QB07-DECGATEBBBB', 'DECGATE class B', 'DECGATE school B', 'Basic 7', 'B7', pg_temp.gid('tpB'), pg_temp.gid('teacherB'), pg_temp.gid('tpB'), pg_temp.gid('curriculum'), 'active', '2026', '1');
insert into public.classes(id,join_code,class_name,school_name,grade_label,grade_code,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status,academic_year,term,join_code_expires_at) values
  (pg_temp.gid('classOld'), 'QB07-DECGATEOLD1', 'DECGATE expired code', 'DECGATE school A', 'Basic 7', 'B7', pg_temp.gid('tpA'), pg_temp.gid('teacherA'), pg_temp.gid('tpA'), pg_temp.gid('curriculum'), 'active', '2026', '1', now() - interval '1 day');

-- Content: four APPROVED active questions on node 1; two NOT approved (review, draft) on node 1; one approved question on node 2
create temp table gate_q(label text primary key, id uuid, status text, validation text, node text, correct text, a text, b text, c text, d text);
insert into gate_q values
 ('q1', 'd0a70000-0000-4000-8000-000000000101', 'active', 'approved', 'node', 'B', '4', '5', '6', '7'),
 ('q2', 'd0a70000-0000-4000-8000-000000000102', 'active', 'approved', 'node', 'C', '7', '10', '12', '14'),
 ('q3', 'd0a70000-0000-4000-8000-000000000103', 'active', 'approved', 'node', 'A', '5', '4', '6', '20'),
 ('q4', 'd0a70000-0000-4000-8000-000000000104', 'active', 'approved', 'node', 'D', '3', '6', '4', '5'),
 ('q_review', 'd0a70000-0000-4000-8000-000000000105', 'active', 'review', 'node', 'A', '1', '2', '3', '4'),
 ('q_draft', 'd0a70000-0000-4000-8000-000000000106', 'archived', 'generated', 'node', 'A', '1', '2', '3', '4'),
 ('q_other', 'd0a70000-0000-4000-8000-000000000107', 'active', 'approved', 'node_other', 'A', '1', '2', '3', '4');
grant all on gate_q to public;
insert into public.questions(id,external_question_id,question_code,subject_code,subject_name,difficulty_code,difficulty_label,cognitive_level,marks,estimated_time_seconds,
    question_text,option_a,option_b,option_c,option_d,correct_answer,answer_type,explanation,hint,status,validation_status,source_type,source_storage_path,commercial_status,tags,version,rendering_version,
    question_content,curriculum_node_id,reviewed_by,reviewed_at,editorial_metadata,source_document_ids)
  select g.id, 'DECGATE-' || g.label, 'DECGATE-' || g.label, 'Mathematics', 'Mathematics', 'easy', 'easy', 'remember', 1, 30,
    'Synthetic question ' || g.label, g.a, g.b, g.c, g.d, g.correct, 'SINGLE_CHOICE', 'Synthetic explanation ' || g.label, 'Synthetic hint', g.status::public.qb_status, g.validation, 'DECGATE_FIXTURE', 'fixtures/decgate', 'INTERNAL_ONLY', array['DECGATE_FIXTURE'], 1, 1,
    jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object('type','text','text','Synthetic question ' || g.label))),
    pg_temp.gid(g.node), pg_temp.gid('teacherA'), now(), '{"human_reviewed":true,"change_note":"synthetic gate fixture"}'::jsonb, array[pg_temp.gid('document')]
  from gate_q g;

-- Platform switches the family tests need (inside this transaction only; the real value is recorded first)
create temp table gate_env as select (select value::text from public.platform_settings where key='flags.family_workspace' and scope_type='global') as family_flag_before;
insert into public.platform_settings(key,scope_type,value) values ('flags.family_workspace','global','true'::jsonb)
  on conflict (key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set value = 'true'::jsonb;
-- PART 2: the checks. Each check calls real RPCs/tables as a real role; a thrown error is the evidence, never a mock.
-- Section order matters: later sections use the classes, assignments and attempts that earlier sections create (all rolled back at the end).

-- ======================= 1. AUTHENTICATION AND ROLE BOUNDARIES (AU) =======================
do $$
declare t text; n bigint; denied boolean; leaked text := ''; sens text[] := array['profiles','student_profiles','teacher_profiles','classes','class_memberships','assignments','attempts','responses','questions','assessment_questions','learner_consent','account_relationships','platform_settings','entitlements','family_workspaces'];
begin
  perform pg_temp.as_anon();
  foreach t in array sens loop
    begin execute format('select count(*) from public.%I', t) into n; if n > 0 then leaked := leaked || t || '(' || n || ') '; end if;
    exception when insufficient_privilege then null; when undefined_table then null; end;
  end loop;
  perform pg_temp.back();
  perform pg_temp.rec('AU','AU-01','Anonymous visitor reads no row of 15 sensitive tables','0 rows or permission denied on every table', leaked = '', nullif(leaked,''));
end $$;

do $$
declare r text := ''; ok boolean := true; res jsonb;
begin
  perform pg_temp.as_anon();
  begin perform public.qb_join_class('QB07-DECGATEAAAA'); r := r || 'join:EXECUTED '; ok := false; exception when others then r := r || 'join:' || sqlstate || ' '; end;
  begin perform public.qb_start_attempt(pg_temp.gid('s1'), null, null, null); r := r || 'start:EXECUTED '; ok := false; exception when others then r := r || 'start:' || sqlstate || ' '; end;
  begin perform public.qb_save_response(pg_temp.gid('s1'), pg_temp.gid('s1'), 'A', null, 1); r := r || 'save:EXECUTED '; ok := false; exception when others then r := r || 'save:' || sqlstate || ' '; end;
  begin perform public.qb_complete_attempt(pg_temp.gid('s1'), 'student_submit'); r := r || 'complete:EXECUTED '; ok := false; exception when others then r := r || 'complete:' || sqlstate || ' '; end;
  begin perform public.qb_family_link_request('x@e2e.quizbox.invalid'); r := r || 'link:EXECUTED '; ok := false; exception when others then r := r || 'link:' || sqlstate || ' '; end;
  begin perform public.qb_class_roster_page(pg_temp.gid('classA'), 1, 10); r := r || 'roster:EXECUTED '; ok := false; exception when others then r := r || 'roster:' || sqlstate || ' '; end;
  perform pg_temp.back();
  perform pg_temp.rec('AU','AU-02','Anonymous visitor cannot run join, start, save, complete, family-link or roster RPCs','every call refused', ok, r);
end $$;

do $$
declare before_role text; after_role text; err text := 'no error'; rows int;
begin
  select role::text into before_role from public.profiles where id = pg_temp.gid('s1');
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin update public.profiles set role = 'admin' where id = pg_temp.gid('s1'); get diagnostics rows = row_count; exception when others then err := sqlstate; rows := -1; end;
  perform pg_temp.back();
  select role::text into after_role from public.profiles where id = pg_temp.gid('s1');
  perform pg_temp.rec('AU','AU-03','A learner cannot make themselves an administrator by editing their own profile','role stays student', after_role = 'student', 'before=' || before_role || ' after=' || after_role || ' rows=' || rows || ' err=' || err);
  update public.profiles set role = 'student' where id = pg_temp.gid('s1');
end $$;

do $$
declare err text := 'no error'; n int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin insert into public.classes(join_code,class_name,grade_label,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status)
        values ('QB07-LEARNERMADE1','Learner-made class','Basic 7', pg_temp.gid('tpA'), pg_temp.gid('s1'), pg_temp.gid('tpA'), pg_temp.gid('curriculum'), 'active'); exception when others then err := sqlstate; end;
  perform pg_temp.back();
  select count(*) into n from public.classes where join_code = 'QB07-LEARNERMADE1';
  perform pg_temp.rec('AU','AU-04','A learner cannot create a class (including one that names a teacher profile that is not theirs)','insert refused, no row', n = 0, 'rows=' || n || ' err=' || err);
  delete from public.classes where join_code = 'QB07-LEARNERMADE1';
end $$;

do $$
declare err text := 'no error'; n int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin insert into public.teacher_profiles(user_id, school_name) values (pg_temp.gid('s1'), 'Self-made teacher'); exception when others then err := sqlstate; end;
  perform pg_temp.back();
  select count(*) into n from public.teacher_profiles where user_id = pg_temp.gid('s1');
  perform pg_temp.rec('AU','AU-05','A learner cannot give themselves a teacher profile','insert refused, no row', n = 0, 'rows=' || n || ' err=' || err);
  delete from public.teacher_profiles where user_id = pg_temp.gid('s1');
end $$;

do $$
declare err text := 'no error'; n int; tid uuid;
begin
  -- What the self-made teacher profile unlocks: the learner can now create classes (the class insert rule asks only for a teacher profile).
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin
    insert into public.teacher_profiles(user_id, school_name) values (pg_temp.gid('s1'), 'Self-made teacher') returning id into tid;
    insert into public.classes(join_code,class_name,grade_label,grade_code,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status)
      values ('QB07-SELFMADE0001','Learner-made class','Basic 7','B7', tid, pg_temp.gid('s1'), tid, pg_temp.gid('curriculum'), 'active');
  exception when others then err := sqlstate || ' ' || sqlerrm; end;
  perform pg_temp.back();
  select count(*) into n from public.classes where join_code = 'QB07-SELFMADE0001';
  perform pg_temp.rec('AU','AU-05b','Follow-on: a learner with a self-made teacher profile still cannot create a class','insert refused, no class', n = 0, 'classes created by a learner=' || n || ' err=' || err);
  delete from public.classes where join_code = 'QB07-SELFMADE0001'; delete from public.teacher_profiles where user_id = pg_temp.gid('s1');
end $$;

do $$
declare err text := 'no error'; res text; v text;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  begin perform public.qb_admin_set_free_allowance(500); res := 'EXECUTED'; exception when others then res := 'refused ' || sqlstate; end;
  perform pg_temp.back();
  perform pg_temp.rec('AU','AU-06','A teacher cannot run an administrator RPC (change the free practice allowance)','refused', res like 'refused%', res);
end $$;

do $$
declare n int; changed int := 0; err text := 'no error'; v1 jsonb; v2 jsonb;
begin
  select value into v1 from public.platform_settings where key = 'flags.family_workspace' and scope_type = 'global';
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin update public.platform_settings set value = 'false'::jsonb where key = 'flags.family_workspace'; get diagnostics changed = row_count; exception when others then err := sqlstate; end;
  begin insert into public.platform_settings(key, scope_type, value) values ('flags.dec_gate_probe', 'global', 'true'::jsonb); changed := changed + 1; exception when others then err := err || '/' || sqlstate; end;
  perform pg_temp.back();
  select value into v2 from public.platform_settings where key = 'flags.family_workspace' and scope_type = 'global';
  perform pg_temp.rec('AU','AU-07','A learner cannot change or add a platform feature flag','no change', changed = 0 and v1 is not distinct from v2, 'changed=' || changed || ' err=' || err);
end $$;

do $$
declare n int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  select count(*) into n from public.profiles where id <> pg_temp.gid('s1');
  perform pg_temp.back();
  perform pg_temp.rec('AU','AU-08','A learner sees no other user''s profile row','0 other profiles', n = 0, 'visible others=' || n);
end $$;

-- ======================= 2. CLASS CREATION (CL) =======================
do $$
declare err text := 'no error'; n int; cid uuid := gen_random_uuid();
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  begin insert into public.classes(id,join_code,class_name,school_name,grade_label,grade_code,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status,academic_year,term)
        values (cid, 'QB07-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)), 'DECGATE teacher-made class', 'DECGATE school A', 'Basic 7', 'B7', pg_temp.gid('tpA'), pg_temp.gid('teacherA'), pg_temp.gid('tpA'), pg_temp.gid('curriculum'), 'active', '2026', '1'); exception when others then err := sqlstate || ' ' || sqlerrm; end;
  perform pg_temp.back();
  select count(*) into n from public.classes where id = cid;
  perform pg_temp.rec('CL','CL-01','A teacher creates a class through the same insert the app uses','row created', n = 1, 'rows=' || n || ' err=' || err);
  insert into gate_ids values ('classNew', cid) on conflict do nothing;
end $$;

do $$
declare err text := 'no error'; n int;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  begin insert into public.classes(join_code,class_name,school_name,grade_label,grade_code,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status)
        values ('QB07-HIJACKB', 'Class pretending to be teacher B''s', 'x', 'Basic 7', 'B7', pg_temp.gid('tpB'), pg_temp.gid('teacherB'), pg_temp.gid('tpB'), pg_temp.gid('curriculum'), 'active'); exception when others then err := sqlstate; end;
  perform pg_temp.back();
  select count(*) into n from public.classes where join_code = 'QB07-HIJACKB';
  perform pg_temp.rec('CL','CL-02','Teacher A cannot create a class that belongs to teacher B','insert refused', n = 0, 'rows=' || n || ' err=' || err);
  delete from public.classes where join_code = 'QB07-HIJACKB';
end $$;

do $$
declare err text := 'no error'; n int; a_codes text;
begin
  -- The same code in a different letter case: the join lookup is case-insensitive, the unique index is not.
  perform pg_temp.as_user(pg_temp.gid('teacherB'));
  begin insert into public.classes(join_code,class_name,school_name,grade_label,grade_code,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status)
        values (lower('QB07-DECGATEAAAA'), 'Look-alike of class A code', 'DECGATE school B', 'Basic 7', 'B7', pg_temp.gid('tpB'), pg_temp.gid('teacherB'), pg_temp.gid('tpB'), pg_temp.gid('curriculum'), 'active'); exception when others then err := sqlstate; end;
  perform pg_temp.back();
  select count(*) into n from public.classes where upper(join_code) = 'QB07-DECGATEAAAA';
  perform pg_temp.rec('CL','CL-03','Join codes are unique regardless of letter case (a second class cannot share another class''s code)','only 1 class per code (case-insensitive)', n = 1, 'classes sharing the code ignoring case=' || n || ' err=' || err);
  delete from public.classes where join_code = lower('QB07-DECGATEAAAA');
end $$;

do $$
declare err text := 'no error'; n int;
begin
  -- The app generates a 12-character random code in the browser. Nothing on the server stops a teacher choosing a short, guessable one.
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  begin insert into public.classes(join_code,class_name,school_name,grade_label,grade_code,teacher_id,teacher_user_id,primary_teacher_id,curriculum_id,status)
        values ('A1', 'Guessable code class', 'DECGATE school A', 'Basic 7', 'B7', pg_temp.gid('tpA'), pg_temp.gid('teacherA'), pg_temp.gid('tpA'), pg_temp.gid('curriculum'), 'active'); exception when others then err := sqlstate; end;
  perform pg_temp.back();
  select count(*) into n from public.classes where join_code = 'A1';
  perform pg_temp.rec('CL','CL-04','The server refuses a short, guessable class code (code strength is enforced by the database, not only the browser)','insert refused', n = 0, 'short code accepted rows=' || n || ' err=' || err);
  delete from public.classes where join_code = 'A1';
end $$;

-- ======================= 3. CLASS-CODE JOINING (JN) =======================
do $$
declare r jsonb; m int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1')); r := public.qb_join_class('QB07-DECGATEAAAA'); perform pg_temp.back();
  select count(*) into m from public.class_memberships where class_id = pg_temp.gid('classA') and student_user_id = pg_temp.gid('s1') and status = 'active';
  perform pg_temp.rec('JN','JN-01','A learner joins a class with its valid code','membership active', m = 1 and r ->> 'status' = 'active', r::text);
end $$;
do $$
declare r jsonb; m int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1')); r := public.qb_join_class('qb07-decgateaaaa '); perform pg_temp.back();
  select count(*) into m from public.class_memberships where class_id = pg_temp.gid('classA') and student_user_id = pg_temp.gid('s1');
  perform pg_temp.rec('JN','JN-02','Joining twice (lower case, trailing space) is idempotent: one membership','1 membership', m = 1, r::text);
end $$;
do $$
declare r jsonb; m int;
begin
  perform pg_temp.as_user(pg_temp.gid('s2')); r := public.qb_join_class('QB07-DECGATEBBBB'); perform pg_temp.back();
  perform pg_temp.rec('JN','JN-03','A second learner joins teacher B''s class','membership active', r ->> 'status' = 'active', r::text);
end $$;
do $$
declare r jsonb; m int;
begin
  perform pg_temp.as_user(pg_temp.gid('s3')); r := public.qb_join_class('QB07-NOSUCHCODE0'); perform pg_temp.back();
  select count(*) into m from public.class_memberships where student_user_id = pg_temp.gid('s3');
  perform pg_temp.rec('JN','JN-04','An invalid code is refused with a clear code and no membership','INVALID_CLASS_CODE, 0 memberships', r ->> 'error' = 'INVALID_CLASS_CODE' and m = 0, r::text);
end $$;
do $$
declare r jsonb; m int;
begin
  perform pg_temp.as_user(pg_temp.gid('s3')); r := public.qb_join_class('QB07-DECGATEOLD1'); perform pg_temp.back();
  select count(*) into m from public.class_memberships where student_user_id = pg_temp.gid('s3');
  perform pg_temp.rec('JN','JN-05','An expired code is refused','CLASS_CODE_EXPIRED, 0 memberships', r ->> 'error' = 'CLASS_CODE_EXPIRED' and m = 0, r::text);
end $$;
do $$
declare r jsonb; m int;
begin
  update public.classes set status = 'archived' where id = pg_temp.gid('classNew');
  declare code text := (select join_code from public.classes where id = pg_temp.gid('classNew')); begin
  perform pg_temp.as_user(pg_temp.gid('s3')); r := public.qb_join_class(code); perform pg_temp.back(); end;
  select count(*) into m from public.class_memberships where student_user_id = pg_temp.gid('s3');
  perform pg_temp.rec('JN','JN-06','An archived class cannot be joined','CLASS_NOT_ACTIVE, 0 memberships', r ->> 'error' = 'CLASS_NOT_ACTIVE' and m = 0, r::text);
end $$;
do $$
declare r jsonb; m int;
begin
  update public.student_profiles set grade_code = 'B4' where user_id = pg_temp.gid('s4');
  perform pg_temp.as_user(pg_temp.gid('s4')); r := public.qb_join_class('QB07-DECGATEAAAA'); perform pg_temp.back();
  select count(*) into m from public.class_memberships where student_user_id = pg_temp.gid('s4');
  perform pg_temp.rec('JN','JN-07','A Basic 4 learner cannot join a Basic 7 class','CLASS_LEVEL_MISMATCH, 0 memberships', r ->> 'error' = 'CLASS_LEVEL_MISMATCH' and m = 0, r::text);
  update public.student_profiles set grade_code = 'B7' where user_id = pg_temp.gid('s4');
end $$;
do $$
declare r jsonb; m int;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherB')); r := public.qb_join_class('QB07-DECGATEAAAA'); perform pg_temp.back();
  select count(*) into m from public.class_memberships where student_user_id = pg_temp.gid('teacherB');
  perform pg_temp.rec('JN','JN-08','A teacher account cannot join a class as a learner','STUDENT_PROFILE_REQUIRED, 0 memberships', r ->> 'error' = 'STUDENT_PROFILE_REQUIRED' and m = 0, r::text);
end $$;
do $$
declare i int; r jsonb; limited int := 0; last_r text;
begin
  -- Guessing: 10 joins a minute are allowed, the 11th must be rate limited.
  delete from quizbox_private.operation_budgets where actor_id = pg_temp.gid('s3');
  perform pg_temp.as_user(pg_temp.gid('s3'));
  for i in 1..14 loop r := public.qb_join_class('QB07-GUESS' || lpad(i::text, 6, '0')); last_r := r::text; if r ->> 'error' = 'QB_RATE_LIMITED' then limited := limited + 1; end if; end loop;
  perform pg_temp.back();
  perform pg_temp.rec('JN','JN-09','Code guessing is rate limited (10 tries a minute per account)','attempts 11-14 return QB_RATE_LIMITED', limited = 4, 'rate-limited tries=' || limited || ' of 14; last=' || last_r);
  delete from quizbox_private.operation_budgets where actor_id = pg_temp.gid('s3');
end $$;
do $$
declare r jsonb;
begin
  perform pg_temp.as_user(pg_temp.gid('s3')); r := public.qb_join_class(repeat('A', 65)); perform pg_temp.back();
  perform pg_temp.rec('JN','JN-10','An oversized code is refused without searching','error returned', r ? 'error', r::text);
  delete from quizbox_private.operation_budgets where actor_id = pg_temp.gid('s3');
end $$;
-- ======================= 4. APPROVED-CONTENT ASSIGNMENT (AS) =======================
do $$
declare r jsonb; snap text; n_targets int;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  r := public.qb_publish_assignment(p_class_id => pg_temp.gid('classA'), p_title => 'DECGATE assignment A1', p_description => 'synthetic', p_curriculum_node_ids => array[pg_temp.gid('node')], p_question_count => 3,
        p_difficulty => null, p_selection_mode => 'AUTOMATIC', p_question_ids => null, p_mode => 'ASSESSMENT', p_attempts_allowed => 2, p_time_limit_minutes => 30, p_start_at => now(), p_due_at => null,
        p_target_student_ids => null, p_remediation_source_assignment_id => null, p_remediation_node_id => null);
  perform pg_temp.back();
  insert into gate_ids values ('asgA1', (r ->> 'assignment_id')::uuid), ('asmA1', (r ->> 'assessment_id')::uuid);
  select string_agg(q.external_question_id, ',' order by q.external_question_id) into snap from public.assessment_questions aq join public.questions q on q.id = aq.question_id where aq.assessment_id = pg_temp.gid('asmA1');
  perform pg_temp.rec('AS','AS-01','A teacher publishes an assignment of 3 questions from 4 approved ones','PUBLISHED, 3 questions', r ->> 'status' = 'PUBLISHED' and (r ->> 'question_count')::int = 3, r::text);
  perform pg_temp.rec('AS','AS-02','The assignment contains only approved, active questions from the chosen topic (no review/draft/other-topic question)','no q_review, q_draft or q_other in the snapshot',
    snap not like '%q_review%' and snap not like '%q_draft%' and snap not like '%q_other%', snap);
  select count(*) into n_targets from public.assignment_targets where assignment_id = pg_temp.gid('asgA1') and status = 'active';
  perform pg_temp.rec('AS','AS-03','Only the active members of class A are targeted (s1 yes; s2 in class B, s3 outsider: no)','1 target (s1)', n_targets = 1 and exists (select 1 from public.assignment_targets t join public.student_profiles sp on sp.id = t.student_id where t.assignment_id = pg_temp.gid('asgA1') and sp.user_id = pg_temp.gid('s1')), 'targets=' || n_targets);
end $$;

do $$
declare r text;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  begin perform public.qb_publish_assignment(p_class_id => pg_temp.gid('classA'), p_title => 'DECGATE not-approved mix', p_description => '', p_curriculum_node_ids => array[pg_temp.gid('node')], p_question_count => 3,
        p_difficulty => null, p_selection_mode => 'MANUAL', p_question_ids => array[(select id from gate_q where label='q1'), (select id from gate_q where label='q_review'), (select id from gate_q where label='q_draft')], p_mode => 'ASSESSMENT',
        p_attempts_allowed => 1, p_time_limit_minutes => 30, p_start_at => now(), p_due_at => null, p_target_student_ids => null, p_remediation_source_assignment_id => null, p_remediation_node_id => null);
        r := 'PUBLISHED'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('AS','AS-04','Hand-picking one approved and two unapproved questions is refused','INSUFFICIENT_APPROVED_QUESTIONS', r like 'INSUFFICIENT_APPROVED_QUESTIONS%', r);
end $$;

do $$
declare r text;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  begin perform public.qb_publish_assignment(p_class_id => pg_temp.gid('classA'), p_title => 'DECGATE too many', p_description => '', p_curriculum_node_ids => array[pg_temp.gid('node')], p_question_count => 5,
        p_difficulty => null, p_selection_mode => 'AUTOMATIC', p_question_ids => null, p_mode => 'ASSESSMENT', p_attempts_allowed => 1, p_time_limit_minutes => 30, p_start_at => now(), p_due_at => null,
        p_target_student_ids => null, p_remediation_source_assignment_id => null, p_remediation_node_id => null); r := 'PUBLISHED'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('AS','AS-05','Asking for 5 questions when only 4 are approved is refused (unapproved questions never fill the gap)','INSUFFICIENT_APPROVED_QUESTIONS:4/5', r like 'INSUFFICIENT_APPROVED_QUESTIONS:4/5%', r);
end $$;

do $$
declare r text; n int;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherB'));
  begin perform public.qb_publish_assignment(p_class_id => pg_temp.gid('classA'), p_title => 'DECGATE cross-tenant publish', p_description => '', p_curriculum_node_ids => array[pg_temp.gid('node')], p_question_count => 2,
        p_difficulty => null, p_selection_mode => 'AUTOMATIC', p_question_ids => null, p_mode => 'ASSESSMENT', p_attempts_allowed => 1, p_time_limit_minutes => 30, p_start_at => now(), p_due_at => null,
        p_target_student_ids => null, p_remediation_source_assignment_id => null, p_remediation_node_id => null); r := 'PUBLISHED'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  select count(*) into n from public.assignments where title = 'DECGATE cross-tenant publish';
  perform pg_temp.rec('AS','AS-06','Teacher B cannot publish an assignment into teacher A''s class','CLASS_ACCESS_DENIED, no assignment row', r = 'CLASS_ACCESS_DENIED' and n = 0, r || ' rows=' || n);
end $$;

do $$
declare r text; n int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin perform public.qb_publish_assignment(p_class_id => pg_temp.gid('classA'), p_title => 'DECGATE learner publish', p_description => '', p_curriculum_node_ids => array[pg_temp.gid('node')], p_question_count => 2,
        p_difficulty => null, p_selection_mode => 'AUTOMATIC', p_question_ids => null, p_mode => 'ASSESSMENT', p_attempts_allowed => 1, p_time_limit_minutes => 30, p_start_at => now(), p_due_at => null,
        p_target_student_ids => null, p_remediation_source_assignment_id => null, p_remediation_node_id => null); r := 'PUBLISHED'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  select count(*) into n from public.assignments where title = 'DECGATE learner publish';
  perform pg_temp.rec('AS','AS-07','A learner cannot publish an assignment','refused, no assignment row', r <> 'PUBLISHED' and n = 0, r || ' rows=' || n);
end $$;

do $$
declare r jsonb; n int;
begin
  -- Teacher B publishes to their own class (used by the cross-tenant checks), and a selected-learner assignment is created in class A.
  perform pg_temp.as_user(pg_temp.gid('teacherB'));
  r := public.qb_publish_assignment(p_class_id => pg_temp.gid('classB'), p_title => 'DECGATE assignment B1', p_description => '', p_curriculum_node_ids => array[pg_temp.gid('node')], p_question_count => 2,
        p_difficulty => null, p_selection_mode => 'AUTOMATIC', p_question_ids => null, p_mode => 'ASSESSMENT', p_attempts_allowed => 1, p_time_limit_minutes => 30, p_start_at => now(), p_due_at => null,
        p_target_student_ids => null, p_remediation_source_assignment_id => null, p_remediation_node_id => null);
  perform pg_temp.back();
  insert into gate_ids values ('asgB1', (r ->> 'assignment_id')::uuid), ('asmB1', (r ->> 'assessment_id')::uuid);
  perform pg_temp.rec('AS','AS-08','Teacher B publishes to their own class B','PUBLISHED', r ->> 'status' = 'PUBLISHED', r::text);
end $$;

do $$
declare r jsonb; m int; t int;
begin
  -- Late joiner: s4 joins class A AFTER the assignment was published; they must still receive it (the catch-up rule).
  perform pg_temp.as_user(pg_temp.gid('s4')); r := public.qb_join_class('QB07-DECGATEAAAA'); perform pg_temp.back();
  select count(*) into t from public.assignment_targets x join public.student_profiles sp on sp.id = x.student_id where x.assignment_id = pg_temp.gid('asgA1') and sp.user_id = pg_temp.gid('s4') and x.status = 'active';
  perform pg_temp.rec('AS','AS-09','A learner who joins after publication still receives the class assignment (late-joiner catch-up)','target row for s4', t = 1, 'targets for s4=' || t || ' join=' || r::text);
end $$;

-- ======================= 5. QUIZ SUBMISSION (QZ) =======================
do $$
declare r jsonb; g jsonb;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  r := public.qb_start_attempt(pg_temp.gid('asmA1'), pg_temp.gid('asgA1'), pg_temp.gid('classA'), 'gate-session-1');
  perform pg_temp.back();
  insert into gate_ids values ('attS1', (r ->> 'attempt_id')::uuid);
  perform pg_temp.rec('QZ','QZ-01','A targeted learner starts the assignment','attempt created', r ->> 'status' = 'PASS' and (r ->> 'attempt_id') is not null, r::text);
end $$;

do $$
declare r jsonb;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  r := public.qb_start_attempt(pg_temp.gid('asmA1'), pg_temp.gid('asgA1'), pg_temp.gid('classA'), 'gate-session-1-reload');
  perform pg_temp.back();
  perform pg_temp.rec('QZ','QZ-02','Starting again after a phone reload or lost signal resumes the same attempt (no duplicate attempt)','same attempt_id, resumed=true', (r ->> 'attempt_id')::uuid = pg_temp.gid('attS1') and (r ->> 'resumed')::boolean, r::text);
  perform pg_temp.rec('MB','MB-01','Mobile: one in-progress attempt per learner per assignment after repeated starts','1 in-progress attempt', (select count(*) from public.attempts where student_user_id = pg_temp.gid('s1') and assessment_id = pg_temp.gid('asmA1') and status = 'in_progress') = 1, null);
end $$;

do $$
declare g jsonb; txt text;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  g := public.qb_get_attempt(pg_temp.gid('attS1'));
  perform pg_temp.back();
  txt := g::text;
  perform pg_temp.rec('QZ','QZ-03','The question paper the learner downloads before submitting carries no correct answer and no explanation','no correct_answer / explanation / is_correct keys', txt !~* '"(correct_answer|correct_answer_snapshot|explanation|is_correct|correct_index)"', left(txt, 300));
end $$;

do $$
declare n int := 0; m int := 0; e1 text := 'rows'; e2 text := 'rows';
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin select count(*) into n from public.questions where tags @> array['DECGATE_FIXTURE']; exception when insufficient_privilege then e1 := 'permission denied'; end;
  begin select count(*) into m from public.assessment_questions where assessment_id = pg_temp.gid('asmA1'); exception when insufficient_privilege then e2 := 'permission denied'; end;
  perform pg_temp.back();
  perform pg_temp.rec('QZ','QZ-04','A learner cannot read answer keys straight from the question bank or the assignment snapshot tables','permission denied or 0 rows from both', n = 0 and m = 0, 'questions: ' || e1 || ' (' || n || ') ; assessment_questions: ' || e2 || ' (' || m || ')');
end $$;

do $$
declare g jsonb; qid uuid; letter text; i int := 0; r jsonb; sav jsonb; qs jsonb;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  g := public.qb_get_attempt(pg_temp.gid('attS1'));
  qs := coalesce(g -> 'questions', g -> 'items', '[]'::jsonb);
  for qid in select (e ->> 'question_id')::uuid from jsonb_array_elements(qs) e loop
    i := i + 1;
    -- answer the first two correctly and the third wrongly
    select case when i <= 2 then correct else case when correct = 'A' then 'B' else 'A' end end into letter from gate_q where id = qid;
    sav := public.qb_save_response(pg_temp.gid('attS1'), qid, letter, null, 5);
  end loop;
  perform pg_temp.back();
  perform pg_temp.rec('QZ','QZ-05','The learner saves an answer to each question (the paper contained 3 questions)','3 responses stored', (select count(*) from public.responses where attempt_id = pg_temp.gid('attS1')) = 3, 'questions in paper=' || jsonb_array_length(qs) || ' responses=' || (select count(*) from public.responses where attempt_id = pg_temp.gid('attS1')) || ' shape=' || left(g::text, 200));
end $$;

do $$
declare r jsonb; r2 jsonb; results int; xp int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  r := public.qb_complete_attempt(pg_temp.gid('attS1'), 'student_submit');
  r2 := public.qb_complete_attempt(pg_temp.gid('attS1'), 'student_submit');
  perform pg_temp.back();
  select count(*) into results from public.assessment_results where attempt_id = pg_temp.gid('attS1');
  select count(*) into xp from public.xp_transactions where attempt_id = pg_temp.gid('attS1') and reason = 'ASSIGNMENT_COMPLETION';
  perform pg_temp.rec('QZ','QZ-06','Submission is scored by the server: 2 of 3 correct = 66.67 %','score 2 of 3', (r ->> 'score')::numeric = 2 and (r ->> 'total_marks')::numeric = 3, r::text);
  perform pg_temp.rec('QZ','QZ-07','Submitting twice (double tap, retry after a dropped connection) does not create a second result or a second reward','1 result, 1 completion reward, same score', results = 1 and xp = 1 and (r2 ->> 'score') = (r ->> 'score'), 'results=' || results || ' completion rewards=' || xp);
  perform pg_temp.rec('MB','MB-02','Mobile: a retried submit after a dropped connection returns the stored result','second call returns same score', (r2 ->> 'score') = (r ->> 'score'), r2::text);
end $$;

do $$
declare sv jsonb; a text; b text; sc_before numeric; sc_after numeric;
begin
  select string_agg(question_id::text || '=' || coalesce(selected_answer,''), ',' order by question_id) into a from public.responses where attempt_id = pg_temp.gid('attS1');
  select score into sc_before from public.attempts where id = pg_temp.gid('attS1');
  perform pg_temp.as_user(pg_temp.gid('s1'));
  sv := public.qb_save_response(pg_temp.gid('attS1'), (select question_id from public.responses where attempt_id = pg_temp.gid('attS1') order by question_id limit 1), 'D', null, 1);
  perform pg_temp.back();
  select string_agg(question_id::text || '=' || coalesce(selected_answer,''), ',' order by question_id) into b from public.responses where attempt_id = pg_temp.gid('attS1');
  select score into sc_after from public.attempts where id = pg_temp.gid('attS1');
  perform pg_temp.rec('QZ','QZ-08','After submission an answer cannot be changed (stored answers and score stay as submitted)','answers and score unchanged', a is not distinct from b and sc_before = sc_after, 'server reply=' || left(sv::text, 140) || ' | score ' || sc_before || ' -> ' || sc_after);
end $$;

do $$
declare r jsonb; r2 jsonb; r3 jsonb;
begin
  -- attempts_allowed = 2: second attempt allowed, third refused
  perform pg_temp.as_user(pg_temp.gid('s1'));
  r := public.qb_start_attempt(pg_temp.gid('asmA1'), pg_temp.gid('asgA1'), pg_temp.gid('classA'), 'gate-session-2');
  perform public.qb_complete_attempt((r ->> 'attempt_id')::uuid, 'student_submit');
  r3 := public.qb_start_attempt(pg_temp.gid('asmA1'), pg_temp.gid('asgA1'), pg_temp.gid('classA'), 'gate-session-3');
  perform pg_temp.back();
  perform pg_temp.rec('QZ','QZ-09','The attempt limit (2) is enforced by the server','2nd attempt starts, 3rd refused with QB_MAX_ATTEMPTS_REACHED', r ->> 'status' = 'PASS' and r3 ->> 'message' = 'QB_MAX_ATTEMPTS_REACHED', 'second=' || r::text || ' third=' || r3::text);
end $$;

do $$
declare r jsonb; comp text := 'ok'; rev text := 'ok'; before_n int; after_n int; att2 jsonb; q2 uuid; sav2 jsonb;
begin
  -- A learner of ANOTHER class cannot start, write to, finish or review someone else's work
  perform pg_temp.as_user(pg_temp.gid('s2'));
  r := public.qb_start_attempt(pg_temp.gid('asmA1'), pg_temp.gid('asgA1'), pg_temp.gid('classA'), 'gate-intruder');
  perform pg_temp.back();
  perform pg_temp.rec('QZ','QZ-10','A learner from another class cannot start class A''s assignment','refused (not a recipient)', r ->> 'message' = 'QB_ASSESSMENT_RECIPIENT_DENIED', r::text);
  -- s2 starts their own class-B attempt; s1 (not in class B) then tries to write into it while it is in progress
  perform pg_temp.as_user(pg_temp.gid('s2'));
  att2 := public.qb_start_attempt(pg_temp.gid('asmB1'), pg_temp.gid('asgB1'), pg_temp.gid('classB'), 'gate-s2');
  select (e ->> 'question_id')::uuid into q2 from jsonb_array_elements(public.qb_get_attempt((att2 ->> 'attempt_id')::uuid) -> 'questions') e limit 1;
  perform pg_temp.back();
  insert into gate_ids values ('attS2', (att2 ->> 'attempt_id')::uuid);
  select count(*) into before_n from public.responses where attempt_id = pg_temp.gid('attS2');
  perform pg_temp.as_user(pg_temp.gid('s1'));
  sav2 := public.qb_save_response(pg_temp.gid('attS2'), q2, 'A', null, 1);
  begin perform public.qb_complete_attempt(pg_temp.gid('attS2'), 'student_submit'); comp := 'no error'; exception when others then comp := 'refused ' || sqlerrm; end;
  begin perform public.qb_get_attempt_review(pg_temp.gid('attS2')); exception when others then rev := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  -- The completion RPC reports some refusals as a JSON reply instead of an exception, so the effect is what counts: the attempt must still be open and unrewarded.
  select count(*) into after_n from public.responses where attempt_id = pg_temp.gid('attS2');
  perform pg_temp.rec('QZ','QZ-11','Another learner cannot write answers into, submit, or read the review of a learner''s IN-PROGRESS attempt, and cannot trigger rewards on it','no answer added, attempt still in_progress, no reward or learning event created for it, review refused',
    (sav2 ? 'message') and after_n = before_n and rev like 'refused%'
      and (select status::text from public.attempts where id = pg_temp.gid('attS2')) = 'in_progress'
      and (select count(*) from public.xp_transactions where attempt_id = pg_temp.gid('attS2')) = 0
      and (select count(*) from public.learning_events where attempt_id = pg_temp.gid('attS2')) = 0,
    'save reply=' || left(sav2::text, 120) || ' | responses ' || before_n || ' -> ' || after_n || ' | complete call: ' || comp || ' | attempt status=' || (select status::text from public.attempts where id = pg_temp.gid('attS2'))
      || ' | xp rows=' || (select count(*) from public.xp_transactions where attempt_id = pg_temp.gid('attS2')) || ' | learning events=' || (select count(*) from public.learning_events where attempt_id = pg_temp.gid('attS2')) || ' | review: ' || rev);
end $$;

do $$
declare r jsonb; sav jsonb; comp jsonb; st text; q uuid; n_resp int; xp int;
begin
  -- Late learner s4: the attempt deadline passes while the phone is offline. Saving then submitting must not grant extra time.
  perform pg_temp.as_user(pg_temp.gid('s4'));
  r := public.qb_start_attempt(pg_temp.gid('asmA1'), pg_temp.gid('asgA1'), pg_temp.gid('classA'), 'gate-late');
  select (e ->> 'question_id')::uuid into q from jsonb_array_elements(public.qb_get_attempt((r ->> 'attempt_id')::uuid) -> 'questions') e limit 1;
  perform pg_temp.back();
  insert into gate_ids values ('attS4', (r ->> 'attempt_id')::uuid);
  update public.attempts set expires_at = now() - interval '5 minutes', deadline_at = now() - interval '5 minutes' where id = pg_temp.gid('attS4');
  perform pg_temp.as_user(pg_temp.gid('s4'));
  sav := public.qb_save_response(pg_temp.gid('attS4'), q, 'A', null, 1);
  comp := public.qb_complete_attempt(pg_temp.gid('attS4'), 'student_submit');
  perform pg_temp.back();
  select status::text into st from public.attempts where id = pg_temp.gid('attS4');
  select count(*) into n_resp from public.responses where attempt_id = pg_temp.gid('attS4');
  select count(*) into xp from public.xp_transactions where attempt_id = pg_temp.gid('attS4');
  perform pg_temp.rec('MB','MB-03','Mobile: an answer typed after the deadline is refused or discarded (a slow connection gives no extra time)','late answer refused; 0 stored', (sav ? 'message') and n_resp = 0, 'late save reply=' || left(sav::text, 120) || ' | answers stored=' || n_resp || ' | final status=' || st);
  perform pg_temp.rec('MB','MB-04','Mobile: an attempt that ran out of time with no answers earns no reward points','0 xp', xp = 0, 'xp rows=' || xp || ' complete=' || left(comp::text, 140));
end $$;

-- ======================= 6. CROSS-TENANT ISOLATION (TN) =======================
do $$
declare c int; m int; a int; t int; r int; res text := 'ok';
begin
  perform pg_temp.as_user(pg_temp.gid('teacherB'));
  c := pg_temp.cnt(format('select count(*) from public.classes where id = %L', pg_temp.gid('classA')));
  m := pg_temp.cnt(format('select count(*) from public.class_memberships where class_id = %L', pg_temp.gid('classA')));
  a := pg_temp.cnt(format('select count(*) from public.assignments where class_id = %L', pg_temp.gid('classA')));
  t := pg_temp.cnt(format('select count(*) from public.attempts where class_id = %L', pg_temp.gid('classA')));
  r := pg_temp.cnt(format('select count(*) from public.assessment_results where class_id = %L', pg_temp.gid('classA')));
  perform pg_temp.back();
  perform pg_temp.rec('TN','TN-01','Teacher B sees nothing of class A: no class row, members, assignments, attempts or results','0 / 0 / 0 / 0 / 0', c + m + a + t + r = 0, format('classes=%s members=%s assignments=%s attempts=%s results=%s', c, m, a, t, r));
end $$;

do $$
declare c int; m int; a int; t int;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  c := pg_temp.cnt(format('select count(*) from public.classes where id = %L', pg_temp.gid('classB')));
  m := pg_temp.cnt(format('select count(*) from public.class_memberships where class_id = %L', pg_temp.gid('classB')));
  a := pg_temp.cnt(format('select count(*) from public.assignments where class_id = %L', pg_temp.gid('classB')));
  t := pg_temp.cnt(format('select count(*) from public.attempts where class_id = %L', pg_temp.gid('classB')));
  perform pg_temp.back();
  perform pg_temp.rec('TN','TN-02','Teacher A sees nothing of class B','0 / 0 / 0 / 0', c + m + a + t = 0, format('classes=%s members=%s assignments=%s attempts=%s', c, m, a, t));
end $$;

do $$
declare u int; d int; ins text := 'ok'; mem int;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherB'));
  update public.classes set class_name = 'TAKEN OVER' where id = pg_temp.gid('classA'); get diagnostics u = row_count;
  delete from public.classes where id = pg_temp.gid('classA'); get diagnostics d = row_count;
  begin insert into public.class_memberships(class_id, student_id, student_user_id, student_email, student_name, grade, status)
        select pg_temp.gid('classA'), sp.id, sp.user_id, 'x@e2e.quizbox.invalid', 'Forced member', 'B7'::public.qb_grade, 'active' from public.student_profiles sp where sp.user_id = pg_temp.gid('s3'); exception when others then ins := 'refused ' || sqlstate; end;
  perform pg_temp.back();
  mem := pg_temp.cnt(format('select count(*) from public.class_memberships where class_id = %L and student_user_id = %L', pg_temp.gid('classA'), pg_temp.gid('s3')));
  perform pg_temp.rec('TN','TN-03','Teacher B cannot rename, delete or add members to class A','0 rows changed, insert refused', u = 0 and d = 0 and mem = 0, format('renamed=%s deleted=%s forced-member insert=%s members added=%s', u, d, ins, mem));
end $$;

do $$
declare own int; others int; asg int; vis int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  own := pg_temp.cnt(format('select count(*) from public.class_memberships where student_user_id = %L', pg_temp.gid('s1')));
  others := pg_temp.cnt(format('select count(*) from public.class_memberships where student_user_id <> %L', pg_temp.gid('s1')));
  asg := pg_temp.cnt(format('select count(*) from public.assignments where class_id = %L', pg_temp.gid('classB')));
  vis := pg_temp.cnt(format('select count(*) from public.attempts where student_user_id <> %L', pg_temp.gid('s1')));
  perform pg_temp.back();
  perform pg_temp.rec('TN','TN-04','A learner sees only their own memberships, no classmate rows, no other class''s assignments, no other learner''s attempts','own>=1, others 0, B-assignments 0, other attempts 0', own >= 1 and others = 0 and asg = 0 and vis = 0, format('own=%s others=%s classB assignments=%s other attempts=%s', own, others, asg, vis));
end $$;

do $$
declare rev text := 'ok'; bd text := 'ok'; ros text := 'ok'; r jsonb;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherB'));
  begin perform public.qb_attempt_breakdown(pg_temp.gid('attS1')); exception when others then bd := 'refused ' || sqlerrm; end;
  begin perform public.qb_get_attempt_review(pg_temp.gid('attS1')); exception when others then rev := 'refused ' || sqlerrm; end;
  begin r := public.qb_class_roster_page(pg_temp.gid('classA'), 1, 50); ros := case when r::text like '%DECGATE%' or r::text like '%dec-gate-s1%' then 'LEAKED ' || left(r::text, 120) else 'empty/denied ' || left(r::text, 80) end; exception when others then ros := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('TN','TN-05','Teacher B cannot read class A''s attempt breakdown, attempt review or roster by guessing identifiers (IDOR)','all refused or empty', bd like 'refused%' and rev like 'refused%' and ros not like 'LEAKED%', 'breakdown: ' || bd || ' | review: ' || rev || ' | roster: ' || ros);
end $$;

-- ======================= 7. REPORTING (RP) =======================
do $$
declare r jsonb; txt text;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  r := public.qb_class_roster_page(pg_temp.gid('classA'), 1, 50); txt := r::text;
  perform pg_temp.back();
  perform pg_temp.rec('RP','RP-01','Teacher A''s roster for class A lists their learners (s1 and the late joiner s4) and not learners of class B or outsiders','s1 and s4 present; s2, s3 absent',
    txt like '%dec-gate-s1@%' and txt like '%dec-gate-s4@%' and txt not like '%dec-gate-s2@%' and txt not like '%dec-gate-s3@%', left(txt, 300));
end $$;

do $$
declare r text := 'ok';
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin perform public.qb_class_roster_page(pg_temp.gid('classA'), 1, 50); exception when others then r := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('RP','RP-02','A learner cannot open the teacher roster of their own class','refused', r like 'refused%', r);
end $$;

do $$
declare r jsonb; res text; n int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  r := public.qb_my_results_page(1, 25); res := r::text;
  perform pg_temp.back();
  perform pg_temp.rec('RP','RP-03','A learner''s own results page shows their submitted attempt with the score the server computed','contains 66.67 and no other learner''s email', res like '%66.6%' and res not like '%dec-gate-s2@%' and res not like '%dec-gate-s4@%', left(res, 250));
end $$;

do $$
declare r jsonb; res text := 'ok'; txt text;
begin
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  begin r := public.qb_teacher_insights(); txt := r::text; exception when others then res := 'error ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('RP','RP-04','The teacher insights report runs for a teacher and does not mention class B','runs; no DECGATE class B', res = 'ok' and txt not like '%DECGATE class B%', coalesce(left(txt, 250), res));
end $$;

do $$
declare r jsonb; res text := 'ok';
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin r := public.qb_teacher_insights(); res := 'EXECUTED ' || left(r::text, 160); exception when others then res := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('RP','RP-05','A learner who runs the teacher insights report gets no class data (the learner has an attempt in class A)','refused or every list empty',
     res like 'refused%' or ((r -> 'weak_indicators') = '[]'::jsonb and (r -> 'student_progress') = '[]'::jsonb and (r -> 'assignment_completion') = '[]'::jsonb), res);
end $$;
-- ======================= 8. GUARDIAN LINKING (GD) =======================
do $$
declare r jsonb; st text; seen int;
begin
  perform pg_temp.as_user(pg_temp.gid('parentP'));
  r := public.qb_family_link_request('dec-gate-s1@e2e.quizbox.invalid');
  perform pg_temp.back();
  select status into st from public.account_relationships where source_user_id = pg_temp.gid('parentP') and target_user_id = pg_temp.gid('s1') and family_workspace_id is not null;
  insert into gate_ids select 'relP_s1', id from public.account_relationships where source_user_id = pg_temp.gid('parentP') and target_user_id = pg_temp.gid('s1');
  select count(*) into seen from public.notifications where recipient_user_id = pg_temp.gid('s1') and type = 'family_link_request';
  perform pg_temp.rec('GD','GD-01','A parent asks to link to a learner by email: a request is created and the learner is notified','status requested + 1 notification', st = 'requested' and seen = 1, 'status=' || coalesce(st,'none') || ' notifications=' || seen);
end $$;

do $$
declare r text := 'ok';
begin
  -- Before the learner agrees, the parent must see nothing.
  perform pg_temp.as_user(pg_temp.gid('parentP'));
  begin perform public.qb_family_child_summary(pg_temp.gid('s1')); exception when others then r := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('GD','GD-02','Before the learner accepts, the requesting parent sees no progress or profile of the learner','refused', r like 'refused%', r);
end $$;

do $$
declare r text := 'ok'; r2 text := 'ok'; st text;
begin
  -- An unrelated parent cannot accept or decline a request that belongs to someone else's child.
  perform pg_temp.as_user(pg_temp.gid('parentQ'));
  begin perform public.qb_family_link_respond(pg_temp.gid('relP_s1'), true); exception when others then r := 'refused ' || sqlerrm; end;
  begin perform public.qb_family_child_summary(pg_temp.gid('s1')); exception when others then r2 := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  select status into st from public.account_relationships where id = pg_temp.gid('relP_s1');
  perform pg_temp.rec('GD','GD-03','A different parent cannot accept the request or see the learner','accept refused, still requested, summary refused', r like 'refused%' and r2 like 'refused%' and st = 'requested', 'accept: ' || r || ' | summary: ' || r2 || ' | status=' || st);
end $$;

do $$
declare r text := 'ok'; st text;
begin
  -- The requesting parent cannot approve their own request.
  perform pg_temp.as_user(pg_temp.gid('parentP'));
  begin perform public.qb_family_link_respond(pg_temp.gid('relP_s1'), true); exception when others then r := 'refused ' || sqlerrm; end;
  begin update public.account_relationships set status = 'active', consent_status = 'granted' where id = pg_temp.gid('relP_s1'); exception when others then r := r || ' | direct update refused ' || sqlstate; end;
  perform pg_temp.back();
  select status into st from public.account_relationships where id = pg_temp.gid('relP_s1');
  perform pg_temp.rec('GD','GD-04','The requesting parent cannot approve their own link (neither through the RPC nor by editing the row)','still requested', st = 'requested', r || ' | status=' || st);
end $$;

do $$
declare r text := 'ok'; n int;
begin
  -- Forged link: a parent writes an active relationship row to a learner directly.
  perform pg_temp.as_user(pg_temp.gid('parentQ'));
  begin insert into public.account_relationships(source_user_id, target_user_id, relationship_type, status, can_view_progress, consent_status, family_workspace_id, permissions)
        values (pg_temp.gid('parentQ'), pg_temp.gid('s2'), 'parent', 'active', true, 'granted', (select id from public.family_workspaces limit 1), '{"view_progress":true}'::jsonb); exception when others then r := 'refused ' || sqlstate; end;
  perform pg_temp.back();
  select count(*) into n from public.account_relationships where source_user_id = pg_temp.gid('parentQ') and target_user_id = pg_temp.gid('s2');
  perform pg_temp.rec('GD','GD-05','A parent cannot forge an active link by inserting the row directly','insert refused, no row', n = 0, r || ' rows=' || n);
end $$;

do $$
declare r jsonb; st text; prog jsonb; s text;
begin
  -- Learner accepts; the parent then sees progress (and only that child).
  perform pg_temp.as_user(pg_temp.gid('s1')); r := public.qb_family_link_respond(pg_temp.gid('relP_s1'), true); perform pg_temp.back();
  select status into st from public.account_relationships where id = pg_temp.gid('relP_s1');
  perform pg_temp.as_user(pg_temp.gid('parentP')); prog := public.qb_family_child_progress(pg_temp.gid('s1'), 30); perform pg_temp.back();
  s := prog::text;
  perform pg_temp.rec('GD','GD-06','After the learner accepts, the parent is linked and can read that learner''s progress','active + progress returned', st = 'active' and s like '%66%', 'status=' || st || ' progress=' || left(s, 200));
end $$;

do $$
declare r1 text := 'ok'; r2 text := 'ok'; r3 text := 'ok';
begin
  perform pg_temp.as_user(pg_temp.gid('parentQ'));
  begin perform public.qb_family_child_summary(pg_temp.gid('s1')); exception when others then r1 := 'refused ' || sqlerrm; end;
  begin perform public.qb_family_child_progress(pg_temp.gid('s1'), 30); exception when others then r2 := 'refused ' || sqlerrm; end;
  begin perform public.qb_get_attempt_review(pg_temp.gid('attS1')); exception when others then r3 := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('GD','GD-07','An unlinked parent cannot read the linked learner''s summary, progress or attempt review','all refused', r1 like 'refused%' and r2 like 'refused%' and r3 like 'refused%', r1 || ' | ' || r2 || ' | ' || r3);
end $$;

do $$
declare r text := 'ok'; r2 text := 'ok';
begin
  -- Linked parent P still cannot see a DIFFERENT learner (s2), who is not linked to them.
  perform pg_temp.as_user(pg_temp.gid('parentP'));
  begin perform public.qb_family_child_summary(pg_temp.gid('s2')); exception when others then r := 'refused ' || sqlerrm; end;
  begin perform public.qb_get_attempt_review(pg_temp.gid('attS1')); exception when others then r2 := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('GD','GD-08','A linked parent sees only their own linked learner (not s2); the linked child''s answer review is still learner-only','summary(s2) refused', r like 'refused%', 'other child: ' || r || ' | attempt review as parent: ' || r2);
end $$;

do $$
declare a jsonb; b jsonb; n int;
begin
  -- No account-existence oracle: a missing address and a real one give the same answer, and nothing is created for a missing one.
  perform pg_temp.as_user(pg_temp.gid('parentQ'));
  a := public.qb_family_link_request('nobody-here@e2e.quizbox.invalid');
  b := public.qb_family_link_request('dec-gate-s3@e2e.quizbox.invalid');
  perform pg_temp.back();
  select count(*) into n from public.account_relationships where source_user_id = pg_temp.gid('parentQ') and label = 'nobody-here@e2e.quizbox.invalid';
  perform pg_temp.rec('GD','GD-09','A link request for an unknown address looks the same as for a real one (no account enumeration) and creates nothing','identical answers, 0 rows for unknown', a = b and n = 0, a::text || ' vs ' || b::text);
end $$;

do $$
declare r text := 'ok';
begin
  perform pg_temp.as_user(pg_temp.gid('s3'));
  begin perform public.qb_family_link_request('dec-gate-s1@e2e.quizbox.invalid'); r := 'EXECUTED'; exception when others then r := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('GD','GD-10','A learner account cannot send guardian link requests','QB_FAMILY_NOT_ADULT', r like 'refused%', r);
end $$;

do $$
declare r jsonb; r2 text := 'ok';
begin
  -- Revocation: the parent unlinks; access ends at once.
  perform pg_temp.as_user(pg_temp.gid('parentP')); r := public.qb_family_revoke(pg_temp.gid('s1'));
  begin perform public.qb_family_child_progress(pg_temp.gid('s1'), 30); exception when others then r2 := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('GD','GD-11','After the link is revoked the parent immediately loses access to the learner''s progress','refused', r2 like 'refused%', r::text || ' | ' || r2);
end $$;

-- ======================= 9. AGE SAFEGUARDS (AG) =======================
do $$
declare a boolean; b uuid; err text := 'no error'; rows int;
begin
  -- A guardian-managed child (what qb_family_child_provision creates): is_minor = true, managed_by = parent.
  update public.student_profiles set is_minor = true, managed_by = pg_temp.gid('parentP') where user_id = pg_temp.gid('sMinor');
  perform pg_temp.as_user(pg_temp.gid('sMinor'));
  begin update public.student_profiles set is_minor = false, managed_by = null where user_id = pg_temp.gid('sMinor'); get diagnostics rows = row_count; exception when others then err := sqlstate; rows := -1; end;
  perform pg_temp.back();
  select is_minor, managed_by into a, b from public.student_profiles where user_id = pg_temp.gid('sMinor');
  perform pg_temp.rec('AG','AG-01','A managed under-13 learner cannot switch off their own minor flag or guardian (this flag blocks online payment and restricted features)','flags unchanged (is_minor true, managed_by parent)', a is true and b = pg_temp.gid('parentP'), format('after the learner edited their own profile: is_minor=%s managed_by=%s rows=%s err=%s', a, b, rows, err));
  update public.student_profiles set is_minor = true, managed_by = pg_temp.gid('parentP') where user_id = pg_temp.gid('sMinor');
end $$;

do $$
declare a boolean; b uuid; err text := 'no error';
begin
  -- A self-registered learner claiming to be managed by someone else's parent account, or removing the erased/archived markers.
  perform pg_temp.as_user(pg_temp.gid('s3'));
  begin update public.student_profiles set managed_by = pg_temp.gid('parentQ'), is_minor = true where user_id = pg_temp.gid('s3'); exception when others then err := sqlstate; end;
  perform pg_temp.back();
  select is_minor, managed_by into a, b from public.student_profiles where user_id = pg_temp.gid('s3');
  perform pg_temp.rec('AG','AG-02','A learner cannot attach themselves to an unrelated adult as "managed by" them','managed_by stays empty', b is null, format('managed_by=%s is_minor=%s err=%s', b, a, err));
  update public.student_profiles set managed_by = null, is_minor = false where user_id = pg_temp.gid('s3');
end $$;

do $$
declare r text := 'ok';
begin
  -- Managed child: only a sponsor can be linked by email; an ordinary adult (parentQ) gets the same quiet answer as for a missing account.
  perform pg_temp.as_user(pg_temp.gid('parentQ'));
  perform public.qb_family_link_request('dec-gate-sminor@e2e.quizbox.invalid');
  perform pg_temp.back();
  perform pg_temp.rec('AG','AG-03','A managed child cannot be linked by an unrelated adult: no request is created','0 relationships', (select count(*) from public.account_relationships where source_user_id = pg_temp.gid('parentQ') and target_user_id = pg_temp.gid('sMinor')) = 0, null);
end $$;

do $$
declare st text; seen text := 'ok';
begin
  -- A sponsor linking a managed child with no active guardian goes to staff verification, never straight to the child's data.
  perform pg_temp.as_user(pg_temp.gid('sponsorS'));
  perform public.qb_family_link_request('dec-gate-sminor@e2e.quizbox.invalid');
  perform pg_temp.back();
  select status into st from public.account_relationships where source_user_id = pg_temp.gid('sponsorS') and target_user_id = pg_temp.gid('sMinor');
  perform pg_temp.as_user(pg_temp.gid('sponsorS'));
  begin perform public.qb_family_child_summary(pg_temp.gid('sMinor')); exception when others then seen := 'refused ' || sqlerrm; end;
  perform pg_temp.back();
  perform pg_temp.rec('AG','AG-04','A sponsor request for a managed child with no guardian waits for staff verification and shows no child data meanwhile','pending_verification + summary refused', st = 'pending_verification' and seen like 'refused%', 'status=' || coalesce(st,'none') || ' | ' || seen);
end $$;

do $$
declare r1 text := 'ok'; r2 text := 'ok'; r3 text := 'ok'; st text;
begin
  -- Consent records: only staff or an active guardian-type relationship can change them.
  perform pg_temp.as_user(pg_temp.gid('parentQ')); begin perform public.qb_consent_set(pg_temp.gid('sMinor'), 'granted', 'attempt by unrelated adult'); exception when others then r1 := 'refused ' || sqlerrm; end; perform pg_temp.back();
  perform pg_temp.as_user(pg_temp.gid('sMinor')); begin perform public.qb_consent_set(pg_temp.gid('sMinor'), 'granted', 'attempt by the child'); exception when others then r2 := 'refused ' || sqlerrm; end; perform pg_temp.back();
  perform pg_temp.as_user(pg_temp.gid('sMinor'));
  begin insert into public.learner_consent(user_id, status, policy_ref) values (pg_temp.gid('sMinor'), 'granted', 'self-written'); exception when others then r3 := 'refused ' || sqlstate; end;
  begin update public.learner_consent set status = 'granted' where user_id = pg_temp.gid('sMinor'); exception when others then r3 := r3 || ' update refused ' || sqlstate; end;
  perform pg_temp.back();
  select status into st from public.learner_consent where user_id = pg_temp.gid('sMinor');
  perform pg_temp.rec('AG','AG-05','Neither an unrelated adult nor the child can grant parental consent (RPC or direct write)','all refused, no consent row created', r1 like 'refused%' and r2 like 'refused%' and st is null, 'unrelated adult: ' || r1 || ' | child: ' || r2 || ' | direct: ' || r3 || ' | consent row=' || coalesce(st,'none'));
end $$;

do $$
declare m boolean; m2 boolean; m3 boolean;
begin
  update public.student_profiles set is_minor = true, managed_by = null where user_id = pg_temp.gid('s3');
  select public.qb_pg_minor_blocked(pg_temp.gid('s3')) into m;                -- self-registered minor
  select public.qb_pg_minor_blocked(pg_temp.gid('sMinor')) into m2;           -- guardian-managed minor
  select public.qb_pg_minor_blocked(pg_temp.gid('s1')) into m3;               -- adult-or-unflagged
  perform pg_temp.rec('AG','AG-06','Partner access treats a self-registered minor as blocked until consent, a managed minor and an unflagged learner as not blocked','true / false / false', m is true and m2 is false and m3 is false, format('self-registered minor=%s managed minor=%s unflagged=%s', m, m2, m3));
  update public.student_profiles set is_minor = false where user_id = pg_temp.gid('s3');
end $$;

do $$
declare r jsonb; n int;
begin
  -- Observation: a self-registered under-13 learner (not managed, no consent) can join a school class by code and appears in the teacher's roster with name and email.
  update public.student_profiles set is_minor = true, managed_by = null where user_id = pg_temp.gid('s3');
  perform pg_temp.as_user(pg_temp.gid('s3')); r := public.qb_join_class('QB07-DECGATEAAAA'); perform pg_temp.back();
  select count(*) into n from public.class_memberships where student_user_id = pg_temp.gid('s3') and status = 'active';
  perform pg_temp.rec('AG','AG-07','A self-registered under-13 learner with no guardian and no consent record cannot join a class (teacher would receive a child''s name and email)','join refused until a guardian or school consent exists', n = 0, r::text);
  delete from public.class_memberships where student_user_id = pg_temp.gid('s3'); update public.student_profiles set is_minor = false where user_id = pg_temp.gid('s3');
  delete from quizbox_private.operation_budgets where actor_id = pg_temp.gid('s3');
end $$;

-- ======================= 10. PILOT ENTITLEMENT (EN) =======================
do $$
declare lim_before jsonb; ex1 boolean; ex2 boolean; ex3 boolean; ex4 boolean; a jsonb;
begin
  select value into lim_before from public.qb_access_settings where key = 'free_practice_sessions';
  insert into public.qb_access_settings(key, value) values ('free_practice_sessions', '0'::jsonb) on conflict (key) do update set value = '0'::jsonb;
  insert into public.user_capabilities(user_id, capability, active) values (pg_temp.gid('admin'), 'super_admin', true);
  ex1 := public.qb_free_allowance_exhausted(pg_temp.gid('s2'));
  -- the pilot grant is made by a super administrator through the real RPC
  perform pg_temp.as_user(pg_temp.gid('admin'));
  a := public.qb_admin_grant_subscription(pg_temp.gid('s2'), 28, 'pilot', 'December pilot school, 4 weeks');
  perform pg_temp.back();
  ex2 := public.qb_free_allowance_exhausted(pg_temp.gid('s2'));
  update public.learner_subscriptions set valid_until = now() - interval '1 minute', valid_from = now() - interval '29 days' where user_id = pg_temp.gid('s2');
  ex3 := public.qb_free_allowance_exhausted(pg_temp.gid('s2'));
  update public.learner_subscriptions set valid_until = now() + interval '10 days', valid_from = now() - interval '1 day', status = 'revoked', revoked_at = now() where user_id = pg_temp.gid('s2');
  ex4 := public.qb_free_allowance_exhausted(pg_temp.gid('s2'));
  perform pg_temp.rec('EN','EN-01','With the free allowance at 0, an unsubscribed learner is blocked','exhausted = true', ex1, 'exhausted=' || ex1);
  perform pg_temp.rec('EN','EN-02','A pilot grant by a super administrator (28 days) lifts the block','exhausted = false', a ->> 'plan' = 'pilot' and ex2 is false, 'grant=' || left(a::text, 120) || ' exhausted after grant=' || ex2);
  perform pg_temp.rec('EN','EN-03','When the pilot period ends the block returns on its own','exhausted = true after expiry', ex3, 'exhausted=' || ex3);
  perform pg_temp.rec('EN','EN-04','A revoked pilot grant stops working immediately even if its end date is in the future','exhausted = true after revoke', ex4, 'exhausted=' || ex4);
  if lim_before is null then delete from public.qb_access_settings where key = 'free_practice_sessions'; else update public.qb_access_settings set value = lim_before where key = 'free_practice_sessions'; end if;
end $$;

do $$
declare r text := ''; ok boolean := true; role_name text; uid uuid;
begin
  foreach role_name in array array['s1','teacherA','parentQ'] loop
    uid := pg_temp.gid(role_name);
    perform pg_temp.as_user(uid);
    begin perform public.qb_admin_grant_subscription(uid, 30, 'pilot', 'self grant attempt'); r := r || role_name || ':grant EXECUTED; '; ok := false; exception when others then null; end;
    begin perform public.qb_wallet_adjust(uid, 'purchased', 1000, 'self credit', 'gate-' || role_name); r := r || role_name || ':wallet EXECUTED; '; ok := false; exception when others then null; end;
    begin perform public.qb_staff_set(uid, array['super_admin']); r := r || role_name || ':staff EXECUTED; '; ok := false; exception when others then null; end;
    begin perform public.qb_reviewer_application_decide(uid, 'approved', 'self', '[]'::jsonb); r := r || role_name || ':reviewer EXECUTED; '; ok := false; exception when others then null; end;
    perform pg_temp.back();
  end loop;
  perform pg_temp.rec('EN','EN-05','A learner, a teacher and a parent cannot grant themselves a subscription, wallet credit, staff role or reviewer approval','all four RPCs refused for all three roles', ok, nullif(r, ''));
end $$;

do $$
declare r text := ''; ok boolean := true; t text; err text;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  foreach t in array array['learner_subscriptions','entitlements','access_entitlements','wallets','subscriptions','user_capabilities'] loop
    begin
      if t = 'learner_subscriptions' then insert into public.learner_subscriptions(user_id, plan, valid_until, source) values (pg_temp.gid('s1'), 'learner', now() + interval '365 days', 'self');
      elsif t = 'entitlements' then insert into public.entitlements(beneficiary_user_id, source_type, entitlement_type, status) values (pg_temp.gid('s1'), 'self', 'subscription', 'active');
      elsif t = 'access_entitlements' then insert into public.access_entitlements(user_id, kind, source, status) values (pg_temp.gid('s1'), 'subscription', 'self', 'active');
      elsif t = 'wallets' then insert into public.wallets(user_id, purchased_balance, promotional_balance) values (pg_temp.gid('s1'), 100000, 100000);
      elsif t = 'subscriptions' then insert into public.subscriptions(subscriber_type, subscriber_id, plan_id, status) values ('user', pg_temp.gid('s1'), gen_random_uuid(), 'active');
      else insert into public.user_capabilities(user_id, capability, active) values (pg_temp.gid('s1'), 'super_admin', true); end if;
      r := r || t || ':WRITTEN; '; ok := false;
    exception when others then null; end;
  end loop;
  perform pg_temp.back();
  perform pg_temp.rec('EN','EN-06','A learner cannot write their own subscription, entitlement, wallet balance or admin capability rows','6 inserts refused', ok, nullif(r, ''));
end $$;

do $$
declare n int; m int;
begin
  perform pg_temp.as_user(pg_temp.gid('s1'));
  n := pg_temp.cnt(format('select count(*) from public.learner_subscriptions where user_id <> %L', pg_temp.gid('s1')));
  perform pg_temp.back();
  perform pg_temp.as_user(pg_temp.gid('teacherB'));
  m := pg_temp.cnt(format('select count(*) from public.learner_subscriptions where user_id = %L', pg_temp.gid('s2')));
  perform pg_temp.back();
  perform pg_temp.rec('EN','EN-07','A learner cannot read others'' subscriptions and a teacher cannot read a learner''s pilot grant','0 and 0', n = 0 and m = 0, 'other learners visible=' || n || ' teacher B sees s2 grant rows=' || m);
end $$;
-- ======================= 11. ADDITIONAL INTEGRITY CHECKS =======================
do $$
declare n_asg_before int; n_asg_after int; seen_a int; seen_s1 int; err text := 'no error'; ins int := 0;
begin
  -- Teacher B writes an assignment row straight into teacher A's class (bypassing the publish RPC).
  select count(*) into n_asg_before from public.assignments where class_id = pg_temp.gid('classA');
  perform pg_temp.as_user(pg_temp.gid('teacherB'));
  begin
    insert into public.assignments(assessment_id,class_id,teacher_id,teacher_user_id,subject_code,subject_name,grade,title,recipient_mode,question_count,difficulty,time_limit_minutes,attempts_allowed,status)
      select assessment_id, pg_temp.gid('classA'), teacher_id, teacher_user_id, subject_code, subject_name, grade, 'DECGATE injected by teacher B', recipient_mode, question_count, difficulty, time_limit_minutes, attempts_allowed, status
      from public.assignments where id = pg_temp.gid('asgB1');
    get diagnostics ins = row_count;
  exception when others then err := sqlstate || ' ' || sqlerrm; end;
  perform pg_temp.back();
  select count(*) into n_asg_after from public.assignments where class_id = pg_temp.gid('classA');
  perform pg_temp.as_user(pg_temp.gid('teacherA')); seen_a := pg_temp.cnt('select count(*) from public.assignments where title = ''DECGATE injected by teacher B'''); perform pg_temp.back();
  perform pg_temp.as_user(pg_temp.gid('s1')); seen_s1 := pg_temp.cnt('select count(*) from public.assignments where title = ''DECGATE injected by teacher B'''); perform pg_temp.back();
  perform pg_temp.rec('TN','TN-06','Teacher B cannot write an assignment row into teacher A''s class by editing the table directly','insert refused, class A unchanged', n_asg_after = n_asg_before, format('rows inserted=%s; class A assignments %s -> %s; teacher A sees it=%s; learner s1 sees it=%s; err=%s', ins, n_asg_before, n_asg_after, seen_a, seen_s1, err));
  delete from public.assignments where title = 'DECGATE injected by teacher B';
end $$;

do $$
declare r text := ''; ok boolean := true; t text;
begin
  -- Score forging: a learner writes their own attempt / result / answer / reward rows directly.
  perform pg_temp.as_user(pg_temp.gid('s1'));
  begin insert into public.assessment_results(assessment_id, attempt_id, student_id, student_user_id, score, total_marks, percentage, status)
          select asmB1.id, gen_random_uuid(), sp.id, sp.user_id, 100, 100, 100, 'final' from public.student_profiles sp, (select pg_temp.gid('asmA1') id) asmB1 where sp.user_id = pg_temp.gid('s1'); r := r || 'results:WRITTEN '; ok := false; exception when others then null; end;
  begin insert into public.xp_transactions(student_user_id, attempt_id, reason, points, metadata) values (pg_temp.gid('s1'), pg_temp.gid('attS1'), 'FORGED', 9999, '{}'); r := r || 'xp:WRITTEN '; ok := false; exception when others then null; end;
  begin update public.attempts set score = 3, percentage = 100, correct_count = 3 where id = pg_temp.gid('attS1'); if found then r := r || 'attempt-update:CHANGED '; ok := false; end if; exception when others then null; end;
  begin update public.responses set is_correct = true where attempt_id = pg_temp.gid('attS1'); if found then r := r || 'response-update:CHANGED '; ok := false; end if; exception when others then null; end;
  begin insert into public.attempts(assessment_id, student_id, student_user_id, status, score, percentage) select pg_temp.gid('asmA1'), sp.id, sp.user_id, 'submitted', 3, 100 from public.student_profiles sp where sp.user_id = pg_temp.gid('s1'); r := r || 'attempt-insert:WRITTEN '; ok := false; exception when others then null; end;
  perform pg_temp.back();
  perform pg_temp.rec('QZ','QZ-12','A learner cannot forge a result, a reward, an attempt score or a marked answer by writing the tables directly','all five direct writes refused or no row changed', ok, nullif(r, ''));
end $$;

do $$
declare r text := 'ok'; marker uuid := gen_random_uuid(); n int;
begin
  -- The tracking and audit tables: a signed-in user cannot read or rewrite the audit trail.
  perform pg_temp.as_user(pg_temp.gid('teacherA'));
  n := pg_temp.cnt(format('select count(*) from public.audit_logs where actor_user_id is distinct from %L', pg_temp.gid('teacherA')));
  begin delete from public.audit_logs; exception when others then null; end;
  begin update public.audit_logs set status = 'tampered'; exception when others then null; end;
  perform pg_temp.back();
  perform pg_temp.rec('AU','AU-09','A teacher reads only their own audit entries and cannot edit or delete any','0 foreign rows readable, nothing tampered', n = 0 and (select count(*) from public.audit_logs where status = 'tampered') = 0, 'audit rows of other people readable by the teacher=' || n);
end $$;

do $$
declare no_rls text; trunc text; anon_w text;
begin
  select string_agg(c.relname, ',') into no_rls from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity;
  select string_agg(c.relname, ',') into trunc from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and (has_table_privilege('authenticated', c.oid, 'truncate') or has_table_privilege('anon', c.oid, 'truncate'));
  select string_agg(c.relname, ',') into anon_w from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'));
  perform pg_temp.rec('AU','AU-10','Every public table has row-level security on','no table without RLS', no_rls is null, left(no_rls, 300));
  perform pg_temp.rec('AU','AU-11','Browser roles hold no TRUNCATE on public tables and anonymous visitors hold no write privilege','none', trunc is null and anon_w is null, 'truncate: ' || coalesce(left(trunc, 200), 'none') || ' | anon write: ' || coalesce(left(anon_w, 200), 'none'));
end $$;

do $$
declare m boolean;
begin
  -- Chain: the consent gate for a self-registered minor is bypassed once the learner names any adult as the manager.
  update public.student_profiles set is_minor = true, managed_by = null where user_id = pg_temp.gid('s2');
  perform pg_temp.as_user(pg_temp.gid('s2'));
  begin update public.student_profiles set managed_by = pg_temp.gid('teacherB') where user_id = pg_temp.gid('s2'); exception when others then null; end;
  perform pg_temp.back();
  select public.qb_pg_minor_blocked(pg_temp.gid('s2')) into m;
  perform pg_temp.rec('AG','AG-08','A self-registered minor cannot lift the partner-access consent block by naming a "manager" on their own profile','still blocked (true)', m is true, 'qb_pg_minor_blocked after the learner edits managed_by=' || m);
  update public.student_profiles set is_minor = false, managed_by = null where user_id = pg_temp.gid('s2');
end $$;
-- ======================= REPORT =======================
select 'RESULTS' as section;
select area, id, status, test, coalesce(detail, '') as detail from gate_results order by n;
select 'SUMMARY' as section;
select status, count(*) as checks from gate_results group by status order by 1;
select 'AREAS' as section;
select area, count(*) filter (where status = 'PASS') as pass, count(*) filter (where status = 'FAIL') as fail, count(*) filter (where status = 'BLOCKED') as blocked from gate_results group by area order by area;
select 'FAMILY FLAG BEFORE (this database; the gate switches it on only inside its own transaction)' as section;
select coalesce(family_flag_before, '(no row)') as flags_family_workspace_before from gate_env;
-- Nothing above was kept: the whole run was one transaction.
rollback;
select 'ROLLED BACK. No row of this run exists.' as done;
