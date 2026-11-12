begin;
-- A learner's review of a finished practice or assessment attempt now carries the explanation for each question (intern feedback 2026-11-10: "explanations for the correct answers were not provided").
-- Only qb_get_attempt_review changes, and only for ordinary attempts. Competition attempts keep their own rule: the explanation appears only when the competition's explanationVisibility allows it.
-- The explanation is the question's own text; nothing is shown before the attempt is submitted (the review function already refuses an unsubmitted attempt) and the correct answer was already part of the review.
-- Rollback: supabase/rollback/attempt_review_explanations.sql

create or replace function public.qb_get_attempt_review(p_attempt_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; snap quizbox_competition.snapshots; cfg jsonb; show_answers boolean; show_explanations boolean;
begin
 result:=quizbox_competition.engine_attempt_review(p_attempt_id);
 select s.* into snap from quizbox_competition.snapshots s join quizbox_competition.participations p on p.snapshot_id=s.id where p.attempt_id=p_attempt_id;
 if snap.id is null then
  return jsonb_set(result,'{questions}',coalesce((select jsonb_agg(q||jsonb_build_object('explanation',nullif(btrim(e.explanation),'')) order by (q->>'question_order')::integer)
    from jsonb_array_elements(result->'questions') q left join public.questions e on e.id=(q->>'question_id')::uuid),'[]'::jsonb));
 end if;
 cfg:=snap.payload->'configuration';
 show_answers:=cfg->>'answerVisibility'='after_submission' or (cfg->>'answerVisibility'='after_close' and now()>=(cfg->>'endsAt')::timestamptz);
 show_explanations:=cfg->>'explanationVisibility'='after_submission' or (cfg->>'explanationVisibility'='after_close' and now()>=(cfg->>'endsAt')::timestamptz);
 return jsonb_set(result,'{questions}',coalesce((select jsonb_agg((case when show_answers then q else q-'correct_answer'-'answer_spec' end)||case when show_explanations then jsonb_build_object('explanation',(select v#>>'{content,explanation}' from jsonb_array_elements(snap.payload->'questions') v where v->>'question_id'=q->>'question_id')) else '{}'::jsonb end order by (q->>'question_order')::integer) from jsonb_array_elements(result->'questions') q),'[]'::jsonb));
end $$;
commit;
