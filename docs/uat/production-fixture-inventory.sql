-- READ-ONLY production test-data inventory (fmgccmqxfjppqydkhaiu). Run in the Supabase SQL editor. No persistent writes:
-- the only objects created are four transaction-local TEMP tables (dropped on rollback); the transaction is then switched to READ ONLY
-- before any inventory query runs. (Validated against the Preview branch on 2026-10-06.)
-- Identification rules (same as scripts/acceptance-inventory.ts and scripts/release-data-verification.sql):
--   users:      email ~ ^(admin|student2?|teacher|sponsor|seller)\.test@quizbox\.local$  OR  @e2e.quizbox.invalid
--   classes:    class_name ~* 'acceptance|DEV_ACCEPTANCE_FIXTURE'  OR taught by an acceptance user
--   questions:  source_type in (DEV_ACCEPTANCE_FIXTURE, DEV_FACTORY_PILOT, TESTLAND_FIXTURE) or subject_code='QBTEST'
--   assignments: title ~* 'acceptance|DEV_FACTORY_PILOT' or in a fixture class or by an acceptance user
-- NOTE: admin.test@quizbox.local is the Super Admin UAT account (owner decision) - it is KEPT; it appears below
--       only so the report is honest. Do not treat it as removable.
begin;

create temp table _acc_users on commit drop as
 select id, email from auth.users
 where email ~ '^(admin|student2?|teacher|sponsor|seller)\.test@quizbox\.local$' or email like '%@e2e.quizbox.invalid';
create temp table _fx_q on commit drop as
 select id from public.questions
 where source_type::text in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT','TESTLAND_FIXTURE') or subject_code='QBTEST';
create temp table _fx_class on commit drop as
 select id from public.classes
 where class_name ~* 'acceptance|DEV_ACCEPTANCE_FIXTURE' or teacher_user_id in (select id from _acc_users);
create temp table _fx_asg on commit drop as
 select id, assessment_id from public.assignments
 where title ~* 'acceptance|DEV_FACTORY_PILOT' or class_id in (select id from _fx_class) or teacher_user_id in (select id from _acc_users);

set transaction read only; -- everything below is enforced read-only by the database

-- 1. Headline counts
select 'acceptance_users' k, count(*) n from _acc_users
union all select 'fixture_questions', count(*) from _fx_q
union all select 'fixture_classes', count(*) from _fx_class
union all select 'fixture_assignments', count(*) from _fx_asg
union all select 'attempts_by_acceptance_users', count(*) from public.attempts where student_user_id in (select id from _acc_users)
union all select 'attempts_on_fixture_assignments', count(*) from public.attempts where assignment_id in (select id from _fx_asg)
union all select 'questions_total', count(*) from public.questions
union all select 'classes_total', count(*) from public.classes
union all select 'assignments_total', count(*) from public.assignments
union all select 'users_total', count(*) from auth.users;

-- 2. The acceptance users themselves (email, role if available)
select u.id, u.email, to_jsonb(p) - 'default_market_id' as profile_row
from _acc_users u left join public.profiles p on p.id = u.id order by u.email;

-- 3. Generic per-table footprint: every public table with a user-id column, rows owned by acceptance users
select t.table_name, c.column_name,
 (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I where %I in (select id from _acc_users)', t.table_name, c.column_name), false, true, '')))[1]::text::int as rows_owned
from information_schema.tables t
join information_schema.columns c on c.table_schema=t.table_schema and c.table_name=t.table_name
 and c.column_name in ('user_id','student_user_id','teacher_user_id','owner_user_id','created_by','uploaded_by','profile_id')
 and c.data_type='uuid'
where t.table_schema='public' and t.table_type='BASE TABLE'
order by rows_owned desc, t.table_name;

-- 4. Fixture questions: status, and whether they sit in any assessment
select q.id, q.source_type, q.status, q.validation_status,
       (select count(*) from public.assessment_questions aq where aq.question_id=q.id) as in_assessments,
       (select count(*) from public.assessment_questions aq join public.assignments a on a.assessment_id=aq.assessment_id
         where aq.question_id=q.id and a.id not in (select id from _fx_asg)) as in_NON_fixture_assignments
from public.questions q where q.id in (select id from _fx_q) order by in_NON_fixture_assignments desc, q.id;

-- 5. LINKAGE TO GENUINE DATA (any row here blocks deletion until reviewed)
-- 5a. genuine users enrolled in fixture classes
select 'genuine_member_in_fixture_class' as risk, m.class_id, m.student_user_id
from public.class_memberships m
where m.class_id in (select id from _fx_class) and m.student_user_id not in (select id from _acc_users);
-- 5b. genuine users' attempts on fixture assignments
select 'genuine_attempt_on_fixture_assignment' as risk, a.id as attempt_id, a.student_user_id, a.assignment_id
from public.attempts a
where a.assignment_id in (select id from _fx_asg) and a.student_user_id not in (select id from _acc_users);
-- 5c. fixture questions used by non-fixture assignments
select 'fixture_question_in_genuine_assignment' as risk, aq.question_id, a.id as assignment_id
from public.assessment_questions aq join public.assignments a on a.assessment_id=aq.assessment_id
where aq.question_id in (select id from _fx_q) and a.id not in (select id from _fx_asg);
-- 5d. non-acceptance classes taught by acceptance users / acceptance users owning content of genuine classes
select 'acceptance_teacher_owns_nonfixture_class' as risk, c.id as class_id, c.class_name
from public.classes c where c.teacher_user_id in (select id from _acc_users) and c.id not in (select id from _fx_class);

-- 6. Tenants/markets that look test-only (review manually; not auto-classified)
select 'tenant' as kind, to_jsonb(t) as row from public.tenants t where to_jsonb(t)::text ~* 'accept|fixture|test|e2e' limit 25;
select 'market' as kind, to_jsonb(m) as row from public.markets m where m.is_test limit 25;

rollback;
