-- READ-ONLY follow-up for production (fmgccmqxfjppqydkhaiu). Run in the Supabase SQL editor; nothing is written.
-- Answers: which 2 questions lack attribution, whether they are live/assignable, whether any
-- existing assignment/assessment path is blocked, and whether a backfill is needed.
-- The dashboard has no auth.uid(), so eligibility is simulated by passing an explicit context
-- {market_ids:[<teacher default market>], source_document_ids:[]} to quizbox_market.question_allowed /
-- curriculum_allowed, which is exactly the legacy-question path of the production guard.
begin read only;

-- A. The unattributed questions: identity, status, and whether they are deliverable/visible
select q.id, to_jsonb(q) - 'correct_answer' - 'answer_spec' - 'correct_answer_snapshot' as row_without_answers
from public.questions q
where not exists (select 1 from public.legacy_content_attributions l where l.question_id = q.id)
order by q.id;

-- B. Are they in any assessment/assignment already? (a published assessment containing one blocks qb_start_attempt)
select aq.assessment_id, aq.question_id, to_jsonb(a) as assignment_row
from public.assessment_questions aq
left join public.assignments a on a.assessment_id = aq.assessment_id
where aq.question_id in (select q.id from public.questions q
  where not exists (select 1 from public.legacy_content_attributions l where l.question_id = q.id));

-- C. Question-level eligibility per distinct teacher/default market (legacy path of question_allowed)
with ctxs as (
  select p.id as profile_id, p.default_market_id as market_id,
         jsonb_build_object('market_ids', jsonb_build_array(p.default_market_id), 'source_document_ids', '[]'::jsonb) as ctx
  from public.profiles p where p.default_market_id is not null
),
by_market as (
  select distinct market_id, ctx from ctxs
)
select bm.market_id,
       count(*) filter (where quizbox_market.question_allowed(q.id, bm.ctx)) as questions_allowed,
       count(*) filter (where not quizbox_market.question_allowed(q.id, bm.ctx)) as questions_denied,
       count(*) as questions_total
from by_market bm cross join public.questions q
group by bm.market_id;

-- D. Class/curriculum gate used by qb_publish_assignment (class curriculum must be allowed in the caller's market)
select c.id as class_id, c.curriculum_id, t.market_id as tenant_market_id,
       exists (select 1 from public.market_curricula mc
               where mc.curriculum_id = c.curriculum_id and mc.active) as curriculum_in_active_market
from public.classes c left join public.tenants t on t.id = c.tenant_id;

-- E. Teachers/profiles that have no market at all (resolve_context would raise QB_CONTENT_MARKET_REQUIRED)
select count(*) filter (where default_market_id is null and active_content_context_id is null) as profiles_with_no_market_or_context,
       count(*) as profiles_total
from public.profiles;

-- F. Existing assessments that the guard would now refuse to start (every question must be allowed)
with aq as (
  select a.assessment_id,
         bool_and(quizbox_market.question_allowed(a.question_id,
                  jsonb_build_object('market_ids', (select jsonb_agg(market_id) from public.market_curricula where active),
                                     'source_document_ids','[]'::jsonb))) as all_allowed,
         count(*) as n_questions
  from public.assessment_questions a group by a.assessment_id
)
select count(*) as assessments_total, count(*) filter (where not all_allowed) as assessments_blocked from aq;

rollback;
