-- PRODUCTION: RETIRE ALL DEVELOPMENT-ERA QUESTIONS (fmgccmqxfjppqydkhaiu). Run as ONE execution in the Supabase SQL editor.
-- Basis: docs/uat/production-question-inventory.sql run on 2026-10-07: 86 questions, all development-era (45 AI-generated test runs,
-- 32 dev fixtures, 9 factory pilot), every one pinned by history (84 immutable content attributions, 7 used in assessments, 4 answered),
-- so NONE can be deleted. They are RETIRED instead: status -> 'archived'. Archived questions are excluded from practice, assessments,
-- competitions and coverage counts, so the Content Factory sees every curriculum indicator as empty and generates real questions.
--
-- Only the status column changes. Question text, answers, review state, versions, attributions, attempts and responses are untouched.
-- Reversible: the before-state is listed in the result, and `update public.questions set status = <old> where id = <id>` restores it.
-- ONE transaction; it commits only if every assertion passes, otherwise nothing changes.
begin;
set local lock_timeout = '15s';

-- frozen set: every question that existed when the inventory was taken (created before 2026-10-08). Questions generated after that are never touched.
create temp table _retire as
  select id, status::text as old_status, validation_status, source_type, subject_code, md5(row(question_text, correct_answer, option_a, option_b, option_c, option_d, answer_spec, explanation)::text) as content_hash
  from public.questions where created_at < '2026-10-08';
create temp table _before as select
  (select count(*) from public.legacy_content_attributions) as attributions,
  (select count(*) from public.responses) as responses,
  (select count(*) from public.assessment_questions) as assessment_questions,
  (select count(*) from public.question_versions) as versions,
  (select count(*) from public.questions where created_at >= '2026-10-08') as newer_questions;

do $pre$
declare n bigint; bad text;
begin
  select count(*) into n from _retire;
  if n <> 86 then raise exception 'ABORTED: expected the 86 inventoried questions, found % created before 2026-10-08', n; end if;
  select string_agg(distinct coalesce(source_type, 'NULL'), ', ') into bad from _retire
   where coalesce(source_type, 'NULL') not in ('AI_GENERATED', 'DEV_ACCEPTANCE_FIXTURE', 'TESTLAND_FIXTURE', 'DEV_FACTORY_PILOT') and coalesce(subject_code, '') <> 'QBTEST';
  if bad is not null then raise exception 'ABORTED: unexpected question sources in the set: %', bad; end if;
  select count(*) into n from _retire where old_status <> 'archived';
  if n <> 56 then raise exception 'ABORTED: expected 56 questions still to retire (inventory), found %', n; end if;
end $pre$;

update public.questions q set status = 'archived'
from _retire r where r.id = q.id and q.status::text <> 'archived';

do $post$
declare n bigint;
begin
  select count(*) into n from public.questions q join _retire r on r.id = q.id where q.status::text <> 'archived';
  if n <> 0 then raise exception 'ABORTED: % development questions are not archived', n; end if;
  select count(*) into n from public.questions q join _retire r on r.id = q.id
   where md5(row(q.question_text, q.correct_answer, q.option_a, q.option_b, q.option_c, q.option_d, q.answer_spec, q.explanation)::text) <> r.content_hash
      or q.validation_status is distinct from r.validation_status;
  if n <> 0 then raise exception 'ABORTED: % questions changed content or review state (only status may change)', n; end if;
  if (select attributions from _before) <> (select count(*) from public.legacy_content_attributions) then raise exception 'ABORTED: content attributions changed'; end if;
  if (select responses from _before) <> (select count(*) from public.responses) then raise exception 'ABORTED: learner responses changed'; end if;
  if (select assessment_questions from _before) <> (select count(*) from public.assessment_questions) then raise exception 'ABORTED: assessment questions changed'; end if;
  -- the existing version-capture trigger may record a snapshot of a retired question's current version; history may only grow, never shrink
  if (select count(*) from public.question_versions) < (select versions from _before) then raise exception 'ABORTED: question versions were removed'; end if;
  if exists (select 1 from public.question_versions v where v.created_at >= (select now()) and v.question_id not in (select id from _retire)) then raise exception 'ABORTED: version rows added for questions outside the retired set'; end if;
  if (select newer_questions from _before) <> (select count(*) from public.questions where created_at >= '2026-10-08') then raise exception 'ABORTED: newer questions changed'; end if;
  select count(*) into n from public.questions where status = 'active' and validation_status = 'approved' and id in (select id from _retire);
  if n <> 0 then raise exception 'ABORTED: % development questions still visible to learners', n; end if;
end $post$;

commit;

-- result: what changed (before -> after) and what learners can now see
select 'RETIRED' as section, coalesce(source_type, 'NULL') || ' | was ' || old_status as item, count(*)::text as n from _retire where old_status <> 'archived' group by source_type, old_status
union all select 'ALREADY ARCHIVED', coalesce(source_type, 'NULL'), count(*)::text from _retire where old_status = 'archived' group by source_type
union all select 'NOW', 'questions archived (all development-era)', count(*)::text from public.questions where id in (select id from _retire) and status::text = 'archived'
union all select 'NOW', 'questions visible to learners (active + approved)', count(*)::text from public.questions where status = 'active' and validation_status = 'approved'
order by 1, 2;
