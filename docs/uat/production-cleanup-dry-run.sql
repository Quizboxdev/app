-- !!! SUPERSEDED 2026-10-06 -- DO NOT RUN. The v1 dry run found a hard blocker (competition-linked fixture attempts) and an insufficient scope.
-- Use docs/uat/production-cleanup-dry-run-v2.sql. An execute script for v2 will be written only after the v2 dry-run output has been reviewed.
-- ============================================================================================================================
-- PRODUCTION TEST-TREE CLEANUP  -- DRY RUN  (fmgccmqxfjppqydkhaiu)
-- Reports exactly what docs/uat/production-cleanup.sql WOULD do. Changes nothing: after the temp working tables are built, the transaction is
-- switched to READ ONLY by the database, so no real table can be written. The transaction is never committed (it ends with the session).
-- Run in the Supabase SQL editor as one execution; the last statement returns a single result table.
-- The set definitions and every delete condition below are copied verbatim, by script, from the execute script.
-- ============================================================================================================================
begin;
set local statement_timeout = '120s';

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
create temp table _ublock (user_id uuid, label text);
create temp table _qblock (question_id uuid, label text);

create function pg_temp.cnt(p text, l text, q text) returns void language plpgsql as $f$
declare n bigint;
begin execute q into n; insert into _log(phase, step, action, rows) values (p, l, 'count', n); end $f$;

create function pg_temp.would(l text, tbl text, cond text) returns void language plpgsql as $f$
declare n bigint;
begin
  if to_regclass(tbl) is null then insert into _log(phase, step, action, rows, note) values ('would-delete', l, 'skipped', 0, 'table absent'); return; end if;
  execute format('select count(*) from %s where %s', tbl, cond) into n;
  insert into _log(phase, step, action, rows) values ('would-delete', l, 'rows', n);
end $f$;

-- blocker probes: which removable users / fixture questions are referenced by something that stays (=> they would be RETAINED, not deleted)
create function pg_temp.ublock(label text, tbl text, col text, extra text) returns void language plpgsql as $f$
begin
  if to_regclass(tbl) is null then return; end if;
  execute format('insert into _ublock select distinct %I, %L from %s where %I in (select id from s_users_rm) and (%s)', col, label, tbl, col, extra);
end $f$;
create function pg_temp.qblock(label text, tbl text, col text, extra text) returns void language plpgsql as $f$
begin
  if to_regclass(tbl) is null then return; end if;
  execute format('insert into _qblock select distinct %I, %L from %s where %I in (select id from s_q_fx) and (%s)', col, label, tbl, col, extra);
end $f$;

set transaction read only;   -- from here on the database itself refuses any write to a real table

-- ------------------------------------------------------------ 1. scope sizes
select pg_temp.cnt('scope', 'removable users (admin.test excluded)', 'select count(*) from s_users_rm');
select pg_temp.cnt('scope', 'admin.test present (kept, never touched)', $q$select count(*) from auth.users where lower(email)='admin.test@quizbox.local'$q$);
select pg_temp.cnt('scope', 'fixture questions', 'select count(*) from s_q_fx');
select pg_temp.cnt('scope', 'fixture classes', 'select count(*) from s_c_fx');
select pg_temp.cnt('scope', 'fixture assignments', 'select count(*) from s_a_fx');
select pg_temp.cnt('scope', 'fixture assessments (fixture-only content)', 'select count(*) from s_as_fx');
select pg_temp.cnt('scope', 'fixture attempts', 'select count(*) from s_at_fx');
select pg_temp.cnt('scope', 'test tenants (code ~ ^QB_TEST)', 'select count(*) from s_tenants_fx');
select pg_temp.cnt('scope', 'test markets (is_test)', 'select count(*) from s_markets_fx');
select pg_temp.cnt('scope', 'genuine users (must be unchanged)', 'select count(*) from auth.users where id not in (select id from s_users_rm)');
select pg_temp.cnt('scope', 'genuine classes (must be unchanged)', 'select count(*) from public.classes where id not in (select id from s_c_fx)');
select pg_temp.cnt('scope', 'genuine assignments (must be unchanged)', 'select count(*) from public.assignments where id not in (select id from s_a_fx)');
select pg_temp.cnt('scope', 'legacy_content_attributions (immutable; will not change)', 'select count(*) from public.legacy_content_attributions');

-- ------------------------------------------------------------ 2. the genuine-link assertions the execute script enforces (each must be 0)
select pg_temp.cnt('precheck (must be 0)', 'evidence: genuine_member_in_fixture_class', $q$select count(*) from public.class_memberships m where m.class_id in (select id from s_ev_class) and m.student_user_id not in (select id from s_users_all)$q$);
select pg_temp.cnt('precheck (must be 0)', 'evidence: genuine_attempt_on_fixture_assignment', $q$select count(*) from public.attempts a where a.assignment_id in (select id from s_ev_asg) and a.student_user_id not in (select id from s_users_all)$q$);
select pg_temp.cnt('precheck (must be 0)', 'evidence: fixture_question_in_genuine_assignment', $q$select count(*) from public.assessment_questions aq join public.assignments a on a.assessment_id = aq.assessment_id where aq.question_id in (select id from s_q_fx) and a.id not in (select id from s_ev_asg)$q$);
select pg_temp.cnt('precheck (must be 0)', 'evidence: acceptance_teacher_owns_nonfixture_class', $q$select count(*) from public.classes c where c.teacher_user_id in (select id from s_users_all) and c.id not in (select id from s_ev_class)$q$);
select pg_temp.cnt('precheck (must be 0)', 'removal: genuine member in a class to be deleted', $q$select count(*) from public.class_memberships m where m.class_id in (select id from s_c_fx) and m.student_user_id not in (select id from s_users_rm)$q$);
select pg_temp.cnt('precheck (must be 0)', 'removal: genuine attempt on an assignment/assessment/class to be deleted', $q$select count(*) from public.attempts a where (a.assignment_id in (select id from s_a_fx) or a.assessment_id in (select id from s_as_fx) or a.class_id in (select id from s_c_fx)) and a.student_user_id not in (select id from s_users_rm)$q$);
select pg_temp.cnt('precheck (must be 0)', 'removal: fixture question used by an assignment that is kept', $q$select count(*) from public.assessment_questions aq join public.assignments a on a.assessment_id = aq.assessment_id where aq.question_id in (select id from s_q_fx) and a.id not in (select id from s_a_fx)$q$);
select pg_temp.cnt('precheck (must be 0)', 'removal: kept class taught by a removable user', $q$select count(*) from public.classes c where c.teacher_user_id in (select id from s_users_rm) and c.id not in (select id from s_c_fx)$q$);
select pg_temp.cnt('precheck (must be 0)', 'removal: fixture attempt referenced by competition results/participations', $q$select (select count(*) from quizbox_competition.official_results where attempt_id in (select id from s_at_fx)) + (select count(*) from quizbox_competition.participations where attempt_id in (select id from s_at_fx))$q$);
select pg_temp.cnt('precheck (must be 0)', 'removal: genuine gradebook/result rows on assessments to be deleted', $q$select (select count(*) from public.gradebook where assessment_id in (select id from s_as_fx) and student_user_id not in (select id from s_users_rm)) + (select count(*) from public.assessment_results where assessment_id in (select id from s_as_fx) and student_user_id not in (select id from s_users_rm))$q$);

-- ------------------------------------------------------------ 3. rows each plain delete step would remove (same conditions as the execute script)
select pg_temp.would('responses',                  'public.responses',                   'attempt_id in (select id from s_at_fx)');
select pg_temp.would('learning_events',            'public.learning_events',             'attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm) or assignment_id in (select id from s_a_fx) or class_id in (select id from s_c_fx)');
select pg_temp.would('xp_transactions',            'public.xp_transactions',             'attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm)');
select pg_temp.would('assessment_results',         'public.assessment_results',          'attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm) or assignment_id in (select id from s_a_fx)');
select pg_temp.would('gradebook',                  'public.gradebook',                   'attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm) or assignment_id in (select id from s_a_fx) or assessment_id in (select id from s_as_fx)');
select pg_temp.would('attempts',                   'public.attempts',                    'id in (select id from s_at_fx)');
select pg_temp.would('assignment_targets',         'public.assignment_targets',          'assignment_id in (select id from s_a_fx) or class_id in (select id from s_c_fx) or student_id in (select id from public.student_profiles where user_id in (select id from s_users_rm))');
select pg_temp.would('assignment_question_versions', 'public.assignment_question_versions', 'assignment_id in (select id from s_a_fx)');
select pg_temp.would('assignments',                'public.assignments',                 'id in (select id from s_a_fx)');
select pg_temp.would('assessment_questions',       'public.assessment_questions',        'assessment_id in (select id from s_as_fx)');
select pg_temp.would('assessments',                'public.assessments',                 'id in (select id from s_as_fx)');
select pg_temp.would('mastery_records',            'public.mastery_records',             'student_user_id in (select id from s_users_rm)');
select pg_temp.would('notifications',              'public.notifications',               'recipient_user_id in (select id from s_users_rm) or recipient_profile_id in (select id from s_users_rm)');
select pg_temp.would('class_memberships',          'public.class_memberships',           'class_id in (select id from s_c_fx) or student_user_id in (select id from s_users_rm)');
select pg_temp.would('classes',                    'public.classes',                     'id in (select id from s_c_fx)');

-- ------------------------------------------------------------ 4. fixture questions: which would be retained (still referenced by something that stays)
select pg_temp.qblock('legacy_content_attributions (immutable history)', 'public.legacy_content_attributions', 'question_id', 'true');
select pg_temp.qblock('assessment_questions of a kept assessment', 'public.assessment_questions', 'question_id', 'assessment_id not in (select id from s_as_fx)');
select pg_temp.qblock('assignment_question_versions of a kept assignment', 'public.assignment_question_versions', 'question_id', 'assignment_id not in (select id from s_a_fx)');
select pg_temp.qblock('learning_events that stay', 'public.learning_events', 'question_id', 'not (attempt_id in (select id from s_at_fx) or student_user_id in (select id from s_users_rm) or assignment_id in (select id from s_a_fx) or class_id in (select id from s_c_fx))');
select pg_temp.qblock('responses of a kept attempt', 'public.responses', 'question_id', 'attempt_id not in (select id from s_at_fx)');
select pg_temp.qblock('sme_review_assignments', 'public.sme_review_assignments', 'question_id', 'true');
select pg_temp.qblock('sme_review_events (immutable history)', 'public.sme_review_events', 'question_id', 'true');
select pg_temp.qblock('competition candidates', 'quizbox_competition.candidates', 'question_id', 'true');
select pg_temp.qblock('factory assignment_events (immutable history)', 'quizbox_factory.assignment_events', 'question_id', 'true');
select pg_temp.qblock('factory campaign_questions', 'quizbox_factory.campaign_questions', 'question_id', 'true');
insert into _log(phase, step, action, rows) select 'questions', 'would be DELETED', 'rows', (select count(*) from s_q_fx) - (select count(distinct question_id) from _qblock);
insert into _log(phase, step, action, rows) select 'questions', 'would be RETAINED as inactive historical residue', 'rows', count(distinct question_id) from _qblock;
insert into _log(phase, step, action, rows) select 'questions', 'retained because: ' || label, 'rows', count(distinct question_id) from _qblock group by label;

-- ------------------------------------------------------------ 5. removable users: which would be retained (referenced by something that stays)
select pg_temp.ublock('compensation_policy_versions.created_by (immutable)', 'public.compensation_policy_versions', 'created_by', 'true');
select pg_temp.ublock('content_contexts.owner_user_id (immutable)', 'public.content_contexts', 'owner_user_id', 'true');
select pg_temp.ublock('market_change_requests.user_id', 'public.market_change_requests', 'user_id', 'true');
select pg_temp.ublock('market_change_requests.decided_by', 'public.market_change_requests', 'decided_by', 'true');
select pg_temp.ublock('questions.reviewed_by on a kept/retained question', 'public.questions', 'reviewed_by', 'id not in (select id from s_q_fx) or id in (select question_id from _qblock)');
select pg_temp.ublock('reviewer_earning_states.actor_id (immutable)', 'public.reviewer_earning_states', 'actor_id', 'true');
select pg_temp.ublock('sme_payout_batches.created_by', 'public.sme_payout_batches', 'created_by', 'true');
select pg_temp.ublock('sme_payout_batches.approved_by', 'public.sme_payout_batches', 'approved_by', 'true');
select pg_temp.ublock('sme_review_assignments.assigned_by', 'public.sme_review_assignments', 'assigned_by', 'true');
select pg_temp.ublock('sme_review_assignments.released_by', 'public.sme_review_assignments', 'released_by', 'true');
select pg_temp.ublock('sme_review_assignments.reviewer_id', 'public.sme_review_assignments', 'reviewer_id', 'true');
select pg_temp.ublock('source_documents.approved_by', 'public.source_documents', 'approved_by', 'true');
select pg_temp.ublock('user_capabilities.granted_by (granted to someone else)', 'public.user_capabilities', 'granted_by', 'user_id not in (select id from s_users_rm)');
select pg_temp.ublock('assignments.grade_override_by on a kept assignment', 'public.assignments', 'grade_override_by', 'id not in (select id from s_a_fx)');
select pg_temp.ublock('assignments.teacher_user_id on a kept assignment', 'public.assignments', 'teacher_user_id', 'id not in (select id from s_a_fx)');
select pg_temp.ublock('assessments.owner_user_id on a kept assessment', 'public.assessments', 'owner_user_id', 'id not in (select id from s_as_fx)');
select pg_temp.ublock('content_coverage_targets.updated_by', 'public.content_coverage_targets', 'updated_by', 'true');
select pg_temp.ublock('content_import_batches.imported_by', 'public.content_import_batches', 'imported_by', 'true');
select pg_temp.ublock('competition candidate_history.actor_id', 'quizbox_competition.candidate_history', 'actor_id', 'true');
select pg_temp.ublock('competition drafts.created_by', 'quizbox_competition.drafts', 'created_by', 'true');
select pg_temp.ublock('competition generation_jobs.created_by', 'quizbox_competition.generation_jobs', 'created_by', 'true');
select pg_temp.ublock('competition invitations.invited_by', 'quizbox_competition.invitations', 'invited_by', 'true');
select pg_temp.ublock('competition invitations.participant_id', 'quizbox_competition.invitations', 'participant_id', 'true');
select pg_temp.ublock('competition leaderboard.participant_id', 'quizbox_competition.leaderboard', 'participant_id', 'true');
select pg_temp.ublock('competition official_results.participant_id', 'quizbox_competition.official_results', 'participant_id', 'true');
select pg_temp.ublock('competition organization_members.user_id', 'quizbox_competition.organization_members', 'user_id', 'true');
select pg_temp.ublock('competition participations.participant_id', 'quizbox_competition.participations', 'participant_id', 'true');
select pg_temp.ublock('competition registrations.participant_id', 'quizbox_competition.registrations', 'participant_id', 'true');
select pg_temp.ublock('competition review_events.reviewer_id', 'quizbox_competition.review_events', 'reviewer_id', 'true');
select pg_temp.ublock('competition snapshots.published_by', 'quizbox_competition.snapshots', 'published_by', 'true');
select pg_temp.ublock('factory allocations.adjusted_by', 'quizbox_factory.allocations', 'adjusted_by', 'true');
select pg_temp.ublock('factory assignment_events.actor_id (immutable)', 'quizbox_factory.assignment_events', 'actor_id', 'true');
select pg_temp.ublock('factory campaigns.created_by', 'quizbox_factory.campaigns', 'created_by', 'true');
select pg_temp.ublock('factory campaigns.confirmed_by', 'quizbox_factory.campaigns', 'confirmed_by', 'true');
select pg_temp.ublock('factory events.actor_id (immutable)', 'quizbox_factory.events', 'actor_id', 'true');
select pg_temp.ublock('factory jobs.claimed_by', 'quizbox_factory.jobs', 'claimed_by', 'true');
select pg_temp.ublock('factory scheduler_runs.actor_id', 'quizbox_factory.scheduler_runs', 'actor_id', 'true');
select pg_temp.ublock('factory workload_policies.created_by', 'quizbox_factory.workload_policies', 'created_by', 'true');
-- sponsor profiles that other records point to
insert into _ublock select distinct sp.user_id, 'sponsor profile referenced by policies/organisations/reviews/sources'
  from public.sponsor_profiles sp where sp.user_id in (select id from s_users_rm)
   and (exists (select 1 from public.compensation_policies x where x.sponsor_id = sp.id)
     or exists (select 1 from quizbox_competition.sponsor_organizations x where x.sponsor_id = sp.id)
     or exists (select 1 from public.sme_review_assignments x where x.sponsor_id = sp.id)
     or exists (select 1 from public.source_documents x where x.sponsor_id = sp.id));
insert into _log(phase, step, action, rows) select 'users', 'would be DELETED', 'rows', (select count(*) from s_users_rm) - (select count(distinct user_id) from _ublock);
insert into _log(phase, step, action, rows) select 'users', 'would be RETAINED disabled (historical residue)', 'rows', count(distinct user_id) from _ublock;
insert into _log(phase, step, action, rows) select 'users', 'retained because: ' || label, 'rows', count(distinct user_id) from _ublock group by label;

-- ------------------------------------------------------------ 6. result (single table)
select ord, phase, step, action, value, note from (
  select 1 as ord, seq, phase, step, action, rows::text as value, coalesce(note, '') as note from _log
  union all
  select 2, row_number() over (order by u.email), 'user list', case when exists (select 1 from _ublock b where b.user_id = u.id) then 'RETAIN (disabled)' else 'DELETE' end,
         u.email, coalesce((select string_agg(distinct b.label, '; ') from _ublock b where b.user_id = u.id), ''), ''
  from s_users_rm u
) r order by ord, seq;
