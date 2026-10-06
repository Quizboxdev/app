-- !!! SUPERSEDED 2026-10-06 -- DO NOT RUN. The v1 dry run found a hard blocker (competition-linked fixture attempts) and an insufficient scope.
-- Use docs/uat/production-cleanup-dry-run-v2.sql. An execute script for v2 will be written only after the v2 dry-run output has been reviewed.
-- ============================================================================================================================
-- PRODUCTION TEST-TREE CLEANUP  -- EXECUTE SCRIPT  (fmgccmqxfjppqydkhaiu)
-- Run ONLY after docs/uat/production-cleanup-dry-run.sql has been run and its numbers reviewed, and the 2026-10-06 15:41 backup is confirmed.
-- Run in the Supabase SQL editor as a single execution. It is one transaction: any failed assertion raises, and nothing is committed.
--
-- Guarantees (all enforced in this script, none by convention):
--   * No trigger is disabled, no RLS/security setting is changed, session_replication_role is never touched. QB_IMMUTABLE_HISTORY stays enforced.
--   * admin.test@quizbox.local is excluded from every set and never modified.
--   * The four "genuine link" counts from the evidence are re-checked (with the evidence definitions AND the removal definitions) and the
--     script aborts before the first delete if any is non-zero.
--   * Core operational tables are deleted with plain statements: any unexpected FK dependency aborts the whole transaction.
--   * Users, questions, tenants and markets are deleted one at a time inside savepoints. Anything blocked by immutable history or by a
--     reference outside the removal scope is RETAINED, neutralised (inactive / banned / not assignable) and reported. Nothing is bypassed.
--   * audit_logs, system_events and all other audit/history tables are not touched.
--   * Genuine user/class/assignment/assessment/question/attempt/membership counts must be identical before and after, or the script aborts.
-- Tables that do not exist in this database (e.g. wallet/ledger tables created by migration 20261007100000) are skipped and logged as 'absent'.
-- ============================================================================================================================
begin;
set local lock_timeout = '15s';
set local statement_timeout = '300s';

-- >>> SETS BEGIN (identical text in the dry-run script)
create temp table s_users_rm as
  select u.id, u.email from auth.users u
  where (u.email ~ '^(student2?|teacher|sponsor|seller)\.test@quizbox\.local$' or lower(u.email) like '%@e2e.quizbox.invalid')
    and lower(u.email) <> 'admin.test@quizbox.local';
create temp table s_users_all as   -- evidence definition: removable users plus the kept admin
  select id, email from s_users_rm
  union select u.id, u.email from auth.users u where lower(u.email) = 'admin.test@quizbox.local';
create temp table s_q_fx as
  select id from public.questions
  where source_type::text in ('DEV_ACCEPTANCE_FIXTURE', 'DEV_FACTORY_PILOT', 'TESTLAND_FIXTURE') or subject_code = 'QBTEST';
create temp table s_c_fx as
  select id from public.classes
  where class_name ~* 'acceptance|DEV_ACCEPTANCE_FIXTURE' or teacher_user_id in (select id from s_users_rm);
create temp table s_a_fx as
  select id, assessment_id from public.assignments
  where title ~* 'acceptance|DEV_FACTORY_PILOT' or class_id in (select id from s_c_fx) or teacher_user_id in (select id from s_users_rm);
create temp table s_as_fx as   -- fixture assessments: only fixture assignments, no genuine attempts, only fixture questions, never competition records
  select a.id from public.assessments a
  where (a.id in (select assessment_id from s_a_fx) or a.owner_user_id in (select id from s_users_rm))
    and a.competition_snapshot_id is null
    and not exists (select 1 from quizbox_competition.snapshots s where s.assessment_id = a.id)
    and not exists (select 1 from public.assignments x where x.assessment_id = a.id and x.id not in (select id from s_a_fx))
    and not exists (select 1 from public.attempts t where t.assessment_id = a.id and t.student_user_id not in (select id from s_users_rm))
    and not exists (select 1 from public.assessment_questions aq where aq.assessment_id = a.id and aq.question_id not in (select id from s_q_fx));
create temp table s_at_fx as
  select id from public.attempts
  where assessment_id in (select id from s_as_fx) or assignment_id in (select id from s_a_fx)
     or student_user_id in (select id from s_users_rm) or class_id in (select id from s_c_fx);
create temp table s_ev_class as   -- the evidence definitions (inventory script), including admin.test
  select id from public.classes
  where class_name ~* 'acceptance|DEV_ACCEPTANCE_FIXTURE' or teacher_user_id in (select id from s_users_all);
create temp table s_ev_asg as
  select id from public.assignments
  where title ~* 'acceptance|DEV_FACTORY_PILOT' or class_id in (select id from s_ev_class) or teacher_user_id in (select id from s_users_all);
create temp table s_tenants_fx as select id from public.tenants where code ~ '^QB_TEST';
create temp table s_markets_fx as select id from public.markets where is_test;
-- <<< SETS END

create temp table _log (seq serial primary key, phase text, step text, action text, rows bigint, note text);
create temp table _retained (kind text, id text, label text, reason text);
create temp table _assertions (seq serial primary key, name text, result text);

create function pg_temp.cnt(p text, l text, q text) returns void language plpgsql as $f$
declare n bigint;
begin execute q into n; insert into _log(phase, step, action, rows) values (p, l, 'count', n); end $f$;

create function pg_temp.del(l text, tbl text, cond text) returns void language plpgsql as $f$
declare n bigint;
begin
  if to_regclass(tbl) is null then insert into _log(phase, step, action, rows, note) values ('delete', l, 'skipped', 0, 'table absent'); return; end if;
  execute format('delete from %s where %s', tbl, cond);
  get diagnostics n = row_count;
  insert into _log(phase, step, action, rows) values ('delete', l, 'deleted', n);
end $f$;

-- ---------------------------------------------------------------- BEFORE counts
select pg_temp.cnt('before', 'removable users', 'select count(*) from s_users_rm');
select pg_temp.cnt('before', 'admin.test present (kept)', $q$select count(*) from auth.users where lower(email)='admin.test@quizbox.local'$q$);
select pg_temp.cnt('before', 'fixture questions', 'select count(*) from s_q_fx');
select pg_temp.cnt('before', 'fixture classes', 'select count(*) from s_c_fx');
select pg_temp.cnt('before', 'fixture assignments', 'select count(*) from s_a_fx');
select pg_temp.cnt('before', 'fixture assessments', 'select count(*) from s_as_fx');
select pg_temp.cnt('before', 'fixture attempts', 'select count(*) from s_at_fx');
select pg_temp.cnt('before', 'genuine users', 'select count(*) from auth.users where id not in (select id from s_users_rm)');
select pg_temp.cnt('before', 'genuine classes', 'select count(*) from public.classes where id not in (select id from s_c_fx)');
select pg_temp.cnt('before', 'genuine assignments', 'select count(*) from public.assignments where id not in (select id from s_a_fx)');
select pg_temp.cnt('before', 'genuine assessments', 'select count(*) from public.assessments where id not in (select id from s_as_fx)');
select pg_temp.cnt('before', 'genuine questions', 'select count(*) from public.questions where id not in (select id from s_q_fx)');
select pg_temp.cnt('before', 'genuine attempts', 'select count(*) from public.attempts where id not in (select id from s_at_fx)');
select pg_temp.cnt('before', 'genuine class memberships', 'select count(*) from public.class_memberships where class_id not in (select id from s_c_fx) and student_user_id not in (select id from s_users_rm)');
select pg_temp.cnt('before', 'legacy_content_attributions (immutable)', 'select count(*) from public.legacy_content_attributions');
select pg_temp.cnt('before', 'triggers not in default-enabled state', $q$select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O'$q$);
select pg_temp.cnt('before', 'immutable_legacy_attribution enabled', $q$select count(*) from pg_trigger where tgname='immutable_legacy_attribution' and tgenabled='O'$q$);

-- ---------------------------------------------------------------- PRE-FLIGHT ASSERTIONS (abort before any delete)
do $pre$
declare n bigint; r record;
begin
  for r in select * from (values
    ('evidence: genuine_member_in_fixture_class',
     $q$select count(*) from public.class_memberships m where m.class_id in (select id from s_ev_class) and m.student_user_id not in (select id from s_users_all)$q$),
    ('evidence: genuine_attempt_on_fixture_assignment',
     $q$select count(*) from public.attempts a where a.assignment_id in (select id from s_ev_asg) and a.student_user_id not in (select id from s_users_all)$q$),
    ('evidence: fixture_question_in_genuine_assignment',
     $q$select count(*) from public.assessment_questions aq join public.assignments a on a.assessment_id = aq.assessment_id where aq.question_id in (select id from s_q_fx) and a.id not in (select id from s_ev_asg)$q$),
    ('evidence: acceptance_teacher_owns_nonfixture_class',
     $q$select count(*) from public.classes c where c.teacher_user_id in (select id from s_users_all) and c.id not in (select id from s_ev_class)$q$),
    ('removal: genuine member in a class to be deleted',
     $q$select count(*) from public.class_memberships m where m.class_id in (select id from s_c_fx) and m.student_user_id not in (select id from s_users_rm)$q$),
    ('removal: genuine attempt on an assignment/assessment/class to be deleted',
     $q$select count(*) from public.attempts a where (a.assignment_id in (select id from s_a_fx) or a.assessment_id in (select id from s_as_fx) or a.class_id in (select id from s_c_fx)) and a.student_user_id not in (select id from s_users_rm)$q$),
    ('removal: fixture question used by an assignment that is kept',
     $q$select count(*) from public.assessment_questions aq join public.assignments a on a.assessment_id = aq.assessment_id where aq.question_id in (select id from s_q_fx) and a.id not in (select id from s_a_fx)$q$),
    ('removal: kept class taught by a removable user',
     $q$select count(*) from public.classes c where c.teacher_user_id in (select id from s_users_rm) and c.id not in (select id from s_c_fx)$q$),
    ('removal: fixture attempt referenced by competition results/participations',
     $q$select (select count(*) from quizbox_competition.official_results where attempt_id in (select id from s_at_fx)) + (select count(*) from quizbox_competition.participations where attempt_id in (select id from s_at_fx))$q$),
    ('removal: genuine gradebook/result rows on assessments to be deleted',
     $q$select (select count(*) from public.gradebook where assessment_id in (select id from s_as_fx) and student_user_id not in (select id from s_users_rm)) + (select count(*) from public.assessment_results where assessment_id in (select id from s_as_fx) and student_user_id not in (select id from s_users_rm))$q$)
  ) as t(name, q) loop
    execute r.q into n;
    insert into _assertions(name, result) values (r.name, case when n = 0 then 'PASS (0)' else 'FAIL (' || n || ')' end);
    if n <> 0 then raise exception 'CLEANUP_ABORTED: % = % (must be 0)', r.name, n; end if;
  end loop;
end $pre$;

-- ---------------------------------------------------------------- DELETIONS, FK-safe order. Plain statements: any surprise aborts everything.
select pg_temp.del('responses',                  'public.responses',                   'attempt_id in (select id from s_at_fx)');
select pg_temp.del('learning_events',            'public.learning_events',             'attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm) or assignment_id in (select id from s_a_fx) or class_id in (select id from s_c_fx)');
select pg_temp.del('xp_transactions',            'public.xp_transactions',             'attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm)');
select pg_temp.del('assessment_results',         'public.assessment_results',          'attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm) or assignment_id in (select id from s_a_fx)');
select pg_temp.del('gradebook',                  'public.gradebook',                   'attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm) or assignment_id in (select id from s_a_fx) or assessment_id in (select id from s_as_fx)');
select pg_temp.del('attempts',                   'public.attempts',                    'id in (select id from s_at_fx)');
select pg_temp.del('assignment_targets',         'public.assignment_targets',          'assignment_id in (select id from s_a_fx) or class_id in (select id from s_c_fx) or student_id in (select id from public.student_profiles where user_id in (select id from s_users_rm))');
select pg_temp.del('assignment_question_versions', 'public.assignment_question_versions', 'assignment_id in (select id from s_a_fx)');
select pg_temp.del('assignments',                'public.assignments',                 'id in (select id from s_a_fx)');
select pg_temp.del('assessment_questions',       'public.assessment_questions',        'assessment_id in (select id from s_as_fx)');
select pg_temp.del('assessments',                'public.assessments',                 'id in (select id from s_as_fx)');
select pg_temp.del('mastery_records',            'public.mastery_records',             'student_user_id in (select id from s_users_rm)');
select pg_temp.del('notifications',              'public.notifications',               'recipient_user_id in (select id from s_users_rm) or recipient_profile_id in (select id from s_users_rm)');
select pg_temp.del('class_memberships',          'public.class_memberships',           'class_id in (select id from s_c_fx) or student_user_id in (select id from s_users_rm)');
select pg_temp.del('classes',                    'public.classes',                     'id in (select id from s_c_fx)');

-- ---------------------------------------------------------------- FIXTURE QUESTIONS: delete what can be deleted; retain + neutralise the rest
do $qs$
declare r record; msg text; gone bigint := 0; kept bigint := 0;
begin
  -- No dependants are deleted here: the fixture assignments/assessments/attempts/events above already removed everything in scope. A question that is still
  -- referenced by anything else (a kept assessment, a genuine event, SME/competition/factory history, immutable attribution) is retained and reported.
  for r in select id from s_q_fx order by id loop
    begin
      delete from public.questions where id = r.id;
      gone := gone + 1;
    exception when others then
      get stacked diagnostics msg = message_text;
      insert into _retained(kind, id, label, reason) values ('question', r.id::text, 'fixture question', msg);
      kept := kept + 1;
    end;
  end loop;
  -- retained fixture questions: make them inactive, so they are not user-visible or assignable (status only; immutable history untouched)
  update public.questions set status = 'inactive' where id in (select id::uuid from _retained where kind = 'question') and status::text <> 'inactive';
  insert into _log(phase, step, action, rows) values ('delete', 'questions', 'deleted', gone), ('retain', 'questions', 'retained inactive (historical residue)', kept);
end $qs$;

-- ---------------------------------------------------------------- DISPOSABLE USERS (admin.test excluded by the set definition)
create function pg_temp.opt_user_cleanup(u uuid) returns void language plpgsql as $f$
begin  -- ledger tables exist only after migration 20261007100000; absent in a production without it
  if to_regclass('public.coin_transactions') is not null then
    execute 'delete from public.coin_transactions where actor_id = $1 or wallet_id in (select id from public.wallets where user_id = $1)' using u; end if;
  if to_regclass('public.qpoint_transactions') is not null then execute 'delete from public.qpoint_transactions where user_id = $1' using u; end if;
  if to_regclass('public.wallets') is not null then execute 'delete from public.wallets where user_id = $1' using u; end if;
end $f$;

do $us$
declare r record; msg text; gone bigint := 0; kept bigint := 0;
begin
  for r in select id, email from s_users_rm order by email loop
    begin
      delete from public.user_capabilities where user_id = r.id;   -- only the user's own rows; a capability this user GRANTED to someone else blocks deletion (user retained)
      delete from public.user_market_memberships where user_id = r.id;
      if to_regclass('public.sme_domain_assignments') is not null then delete from public.sme_domain_assignments where reviewer_id = r.id; end if;
      if to_regclass('public.sme_profiles') is not null then delete from public.sme_profiles where user_id = r.id; end if;
      delete from public.sponsor_profiles where user_id = r.id;
      delete from public.marketplace_sellers where seller_type = 'USER' and seller_entity_id = r.id;
      delete from public.tenant_memberships where user_id = r.id;
      delete from public.institution_memberships where user_id = r.id;
      delete from public.teacher_profiles where user_id = r.id;
      delete from public.student_profiles where user_id = r.id;
      perform pg_temp.opt_user_cleanup(r.id);
      delete from auth.users where id = r.id;   -- profiles/auth children cascade; any remaining NO ACTION reference raises and the user is retained
      gone := gone + 1;
    exception when others then
      get stacked diagnostics msg = message_text;
      insert into _retained(kind, id, label, reason) values ('user', r.id::text, r.email, msg);
      kept := kept + 1;
    end;
  end loop;
  insert into _log(phase, step, action, rows) values ('delete', 'users', 'deleted', gone), ('retain', 'users', 'retained disabled (historical residue)', kept);
end $us$;

-- retained users: not active, cannot sign in, hold no capability/market/review role (their rows are kept, deactivated)
do $neutral$
declare ids uuid[];
begin
  select array_agg(id::uuid) into ids from _retained where kind = 'user';
  if ids is null then return; end if;
  update public.profiles set status = 'inactive' where id = any(ids) and status::text <> 'inactive';
  update public.user_capabilities set active = false where user_id = any(ids) and active;
  update public.user_market_memberships set active = false where user_id = any(ids) and active;
  if to_regclass('public.sme_profiles') is not null then update public.sme_profiles set active = false where user_id = any(ids) and active; end if;
  if to_regclass('public.sme_domain_assignments') is not null then update public.sme_domain_assignments set active = false where reviewer_id = any(ids) and active; end if;
  update auth.users set banned_until = 'infinity'::timestamptz where id = any(ids);
end $neutral$;

-- ---------------------------------------------------------------- TEST TENANTS / MARKETS: only if nothing (incl. immutable history) still references them
do $tm$
declare r record; msg text; t_gone bigint := 0; t_kept bigint := 0; m_gone bigint := 0; m_kept bigint := 0;
begin
  for r in select id, code from public.tenants where id in (select id from s_tenants_fx) order by code loop
    begin delete from public.tenants where id = r.id; t_gone := t_gone + 1;
    exception when others then get stacked diagnostics msg = message_text; insert into _retained(kind, id, label, reason) values ('tenant', r.id::text, r.code, msg); t_kept := t_kept + 1; end;
  end loop;
  for r in select id, name from public.markets where id in (select id from s_markets_fx) order by name loop
    begin delete from public.markets where id = r.id; m_gone := m_gone + 1;
    exception when others then get stacked diagnostics msg = message_text; insert into _retained(kind, id, label, reason) values ('market', r.id::text, r.name, msg); m_kept := m_kept + 1; end;
  end loop;
  insert into _log(phase, step, action, rows) values ('delete', 'tenants', 'deleted', t_gone), ('retain', 'tenants', 'retained', t_kept), ('delete', 'markets', 'deleted', m_gone), ('retain', 'markets', 'retained', m_kept);
end $tm$;

-- ---------------------------------------------------------------- AFTER counts
select pg_temp.cnt('after', 'removable users still present (retained)', 'select count(*) from auth.users where id in (select id from s_users_rm)');
select pg_temp.cnt('after', 'admin.test present (kept)', $q$select count(*) from auth.users where lower(email)='admin.test@quizbox.local'$q$);
select pg_temp.cnt('after', 'fixture questions still present (retained)', 'select count(*) from public.questions where id in (select id from s_q_fx)');
select pg_temp.cnt('after', 'fixture classes', 'select count(*) from public.classes where id in (select id from s_c_fx)');
select pg_temp.cnt('after', 'fixture assignments', 'select count(*) from public.assignments where id in (select id from s_a_fx)');
select pg_temp.cnt('after', 'fixture assessments', 'select count(*) from public.assessments where id in (select id from s_as_fx)');
select pg_temp.cnt('after', 'fixture attempts', 'select count(*) from public.attempts where id in (select id from s_at_fx)');
select pg_temp.cnt('after', 'genuine users', 'select count(*) from auth.users where id not in (select id from s_users_rm)');
select pg_temp.cnt('after', 'genuine classes', 'select count(*) from public.classes where id not in (select id from s_c_fx)');
select pg_temp.cnt('after', 'genuine assignments', 'select count(*) from public.assignments where id not in (select id from s_a_fx)');
select pg_temp.cnt('after', 'genuine assessments', 'select count(*) from public.assessments where id not in (select id from s_as_fx)');
select pg_temp.cnt('after', 'genuine questions', 'select count(*) from public.questions where id not in (select id from s_q_fx)');
select pg_temp.cnt('after', 'genuine attempts', 'select count(*) from public.attempts where id not in (select id from s_at_fx)');
select pg_temp.cnt('after', 'genuine class memberships', 'select count(*) from public.class_memberships where class_id not in (select id from s_c_fx) and student_user_id not in (select id from s_users_rm)');
select pg_temp.cnt('after', 'legacy_content_attributions (immutable)', 'select count(*) from public.legacy_content_attributions');
select pg_temp.cnt('after', 'triggers not in default-enabled state', $q$select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O'$q$);
select pg_temp.cnt('after', 'immutable_legacy_attribution enabled', $q$select count(*) from pg_trigger where tgname='immutable_legacy_attribution' and tgenabled='O'$q$);

-- ---------------------------------------------------------------- POST ASSERTIONS (any failure raises; nothing is committed)
do $post$
declare r record; b bigint; a bigint;
begin
  for r in select distinct step from _log where phase = 'before' and step in
      ('genuine users', 'genuine classes', 'genuine assignments', 'genuine assessments', 'genuine questions', 'genuine attempts', 'genuine class memberships',
       'legacy_content_attributions (immutable)', 'triggers not in default-enabled state', 'immutable_legacy_attribution enabled', 'admin.test present (kept)') loop
    select rows into b from _log where phase = 'before' and step = r.step order by seq limit 1;
    select rows into a from _log where phase = 'after' and step = r.step order by seq limit 1;
    insert into _assertions(name, result) values ('unchanged: ' || r.step, case when a = b then 'PASS (' || a || ')' else 'FAIL (' || b || ' -> ' || a || ')' end);
    if a is distinct from b then raise exception 'CLEANUP_ABORTED: % changed from % to %', r.step, b, a; end if;
  end loop;
  for r in select * from (values
    ('no fixture class/assignment/assessment/attempt left',
     $q$select (select count(*) from public.classes where id in (select id from s_c_fx)) + (select count(*) from public.assignments where id in (select id from s_a_fx)) + (select count(*) from public.assessments where id in (select id from s_as_fx)) + (select count(*) from public.attempts where id in (select id from s_at_fx))$q$),
    ('no retained fixture question is active',
     $q$select count(*) from public.questions where id in (select id from s_q_fx) and status::text = 'active'$q$),
    ('no retained removable user is active',
     $q$select count(*) from public.profiles where id in (select id from s_users_rm) and status::text = 'active'$q$),
    ('evidence: genuine_member_in_fixture_class',
     $q$select count(*) from public.class_memberships m where m.class_id in (select id from s_ev_class) and m.student_user_id not in (select id from s_users_all)$q$),
    ('evidence: genuine_attempt_on_fixture_assignment',
     $q$select count(*) from public.attempts a where a.assignment_id in (select id from s_ev_asg) and a.student_user_id not in (select id from s_users_all)$q$),
    ('evidence: fixture_question_in_genuine_assignment',
     $q$select count(*) from public.assessment_questions aq join public.assignments a on a.assessment_id = aq.assessment_id where aq.question_id in (select id from s_q_fx) and a.id not in (select id from s_ev_asg)$q$),
    ('evidence: acceptance_teacher_owns_nonfixture_class',
     $q$select count(*) from public.classes c where c.teacher_user_id in (select id from s_users_all) and c.id not in (select id from s_ev_class)$q$)
  ) as t(name, q) loop
    execute r.q into a;
    insert into _assertions(name, result) values ('after: ' || r.name, case when a = 0 then 'PASS (0)' else 'FAIL (' || a || ')' end);
    if a <> 0 then raise exception 'CLEANUP_ABORTED: after: % = %', r.name, a; end if;
  end loop;
end $post$;

commit;   -- reached only if every assertion above passed

-- ---------------------------------------------------------------- REPORT (temp tables survive the commit within this session)
select ord, phase, step, action, value, note from (
  select 1 as ord, seq, phase, step, action, rows::text as value, coalesce(note, '') as note from _log
  union all select 2, row_number() over (order by kind, label), 'retained', kind, label, id, reason from _retained
  union all select 3, seq, 'assertion', name, result, '', '' from _assertions
) r order by ord, seq;
