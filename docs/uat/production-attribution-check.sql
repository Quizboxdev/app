-- READ-ONLY production check (project fmgccmqxfjppqydkhaiu).
-- Purpose: does market/source enforcement (migration 20261002210000) block teacher
-- assignment on pre-existing production questions? Run in the Supabase dashboard SQL editor.
-- Paste back all result sets. Nothing here writes; the transaction is read-only and rolls back.
begin read only;

-- 1. Attribution coverage (the check behind QB_CONTENT_SOURCE_DENIED for legacy questions)
select
 (select count(*) from public.questions) as questions_total,
 (select count(*) from public.questions q where exists(
    select 1 from public.legacy_content_attributions l
    where l.question_id=q.id and l.curriculum_id=q.curriculum_id)) as with_matching_legacy_attribution,
 (select count(*) from public.questions q where not exists(
    select 1 from public.legacy_content_attributions l where l.question_id=q.id)) as without_any_attribution,
 (select count(*) from public.questions where cardinality(source_document_ids)>0) as with_source_documents,
 (select count(*) from public.market_curricula where active) as active_market_curricula;

-- 2. Class readiness (qb_publish_assignment requires curriculum_allowed(class.curriculum_id))
select
 (select count(*) from public.classes) as classes_total,
 (select count(*) from public.classes where curriculum_id is null) as classes_without_curriculum,
 (select count(*) from public.assignments) as assignments_total;

-- 3. Content mix
select coalesce(source_type::text,'(null)') as source_type, validation_status::text, count(*)
from public.questions group by 1,2 order by 3 desc limit 20;

-- 4. Content Ops UAT cross-check (Ghana Common Core Programme, status=review): expected 93 in the UI
select c.id as curriculum_id, c.name, count(q.*) filter (where q.validation_status::text='review') as review_questions
from public.curricula c left join public.questions q on q.curriculum_id=c.id
where c.name ilike '%Ghana Common Core%' group by 1,2;

rollback;
