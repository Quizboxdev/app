-- Rollback for 20261064100000_attempt_review_explanations.sql: the review goes back to carrying no explanation for ordinary attempts (competition attempts are unchanged).
-- This is the body from 20261002250000_sponsor_source_delivery.sql.
begin;
create or replace function public.qb_get_attempt_review(p_attempt_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; snap quizbox_competition.snapshots; cfg jsonb; show_answers boolean; show_explanations boolean;
begin
 result:=quizbox_competition.engine_attempt_review(p_attempt_id);
 select s.* into snap from quizbox_competition.snapshots s join quizbox_competition.participations p on p.snapshot_id=s.id where p.attempt_id=p_attempt_id;
 if snap.id is null then return result; end if; cfg:=snap.payload->'configuration';
 show_answers:=cfg->>'answerVisibility'='after_submission' or (cfg->>'answerVisibility'='after_close' and now()>=(cfg->>'endsAt')::timestamptz);
 show_explanations:=cfg->>'explanationVisibility'='after_submission' or (cfg->>'explanationVisibility'='after_close' and now()>=(cfg->>'endsAt')::timestamptz);
 return jsonb_set(result,'{questions}',coalesce((select jsonb_agg((case when show_answers then q else q-'correct_answer'-'answer_spec' end)||case when show_explanations then jsonb_build_object('explanation',(select v#>>'{content,explanation}' from jsonb_array_elements(snap.payload->'questions') v where v->>'question_id'=q->>'question_id')) else '{}'::jsonb end order by (q->>'question_order')::integer) from jsonb_array_elements(result->'questions') q),'[]'::jsonb));
end $$;
commit;
