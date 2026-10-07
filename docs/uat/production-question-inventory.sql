-- PRODUCTION QUESTION INVENTORY (READ ONLY: changes nothing). Run as ONE execution in the Supabase SQL editor of fmgccmqxfjppqydkhaiu.
-- Purpose: show every question in the bank, what kind it is (dev fixture / pilot / AI-generated / imported), whether learners can see it,
-- and what history pins it (rows that make deletion impossible or unsafe), so the question cleanup can be planned on today's data.
begin;
set transaction read only;

with q as (
  select q.id, q.source_type, q.status::text as status, q.validation_status, q.subject_code, coalesce(q.canonical_grade_code, q.grade::text) as grade,
         q.curriculum_id, q.created_at,
         case
           when q.source_type in ('DEV_ACCEPTANCE_FIXTURE', 'TESTLAND_FIXTURE') or q.subject_code = 'QBTEST' then 'dev fixture'
           when q.source_type = 'DEV_FACTORY_PILOT' then 'factory pilot'
           when q.source_type = 'AI_GENERATED' then 'AI generated'
           when q.source_type is null then 'unknown source'
           else 'other: ' || q.source_type
         end as kind
  from public.questions q
),
pins as (
  select q.id,
    exists (select 1 from public.legacy_content_attributions x where x.question_id = q.id) as attribution,
    exists (select 1 from public.sme_review_events x where x.question_id = q.id) as review_history,
    exists (select 1 from quizbox_competition.candidates x where x.question_id = q.id) as competition,
    exists (select 1 from public.responses x where x.question_id = q.id) as answered,
    exists (select 1 from public.assessment_questions x where x.question_id = q.id) as in_assessment
  from q
)
select section, item, n from (
  select 1 as ord, 'TOTAL' as section, 'questions in the bank' as item, count(*)::text as n from q
  union all
  select 2, 'BY KIND / STATUS / VALIDATION', kind || ' | ' || status || ' | ' || coalesce(validation_status, '-'), count(*)::text from q group by 1, 2, kind, status, validation_status
  union all
  select 3, 'VISIBLE TO LEARNERS (active + approved)', kind, count(*)::text from q where status = 'active' and validation_status = 'approved' group by kind
  union all
  select 4, 'BY SUBJECT / GRADE', coalesce(subject_code, '-') || ' / ' || coalesce(grade, '-'), count(*)::text from q group by subject_code, grade
  union all
  select 5, 'BY CURRICULUM', coalesce((select c.code from public.curricula c where c.id = q.curriculum_id), '(none)'), count(*)::text from q group by q.curriculum_id
  union all
  select 6, 'CREATED (month)', to_char(date_trunc('month', created_at), 'YYYY-MM') || ' ' || kind, count(*)::text from q group by date_trunc('month', created_at), kind
  union all
  select 7, 'PINNED BY HISTORY (cannot be deleted, only retired)', 'immutable attribution', count(*)::text from pins where attribution
  union all select 7, 'PINNED BY HISTORY (cannot be deleted, only retired)', 'SME review events', count(*)::text from pins where review_history
  union all select 7, 'PINNED BY HISTORY (cannot be deleted, only retired)', 'competition candidates', count(*)::text from pins where competition
  union all select 7, 'PINNED BY HISTORY (cannot be deleted, only retired)', 'answered by a learner (responses)', count(*)::text from pins where answered
  union all select 7, 'PINNED BY HISTORY (cannot be deleted, only retired)', 'used in an assessment', count(*)::text from pins where in_assessment
  union all select 7, 'PINNED BY HISTORY (cannot be deleted, only retired)', 'pinned by any of the above', count(*)::text from pins where attribution or review_history or competition or answered or in_assessment
  union all
  select 8, 'SAMPLE (newest 15)', left(kind || ' | ' || status || ' | ' || coalesce(subject_code, '-') || ' | ' || id::text, 120), to_char(created_at, 'YYYY-MM-DD') from (select * from q order by created_at desc limit 15) s
) r order by ord, section, item;

rollback;
