-- Reverse 20261002260000: restore the original legacy predicate. Attribution rows are immutable
-- by design (trigger) and become inert: the original predicate requires q.curriculum_id to match.
begin;
do $$ declare body text; begin
 body:=pg_get_functiondef('quizbox_competition.curriculum_question_allowed(uuid,jsonb)'::regprocedure);
 body:=replace(body,'l.curriculum_id=coalesce(q.curriculum_id,(select n.curriculum_id from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active))) and quizbox_market.curriculum_allowed(coalesce(q.curriculum_id,(select n.curriculum_id from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active)),c)',
  'l.curriculum_id=q.curriculum_id) and quizbox_market.curriculum_allowed(q.curriculum_id,c)');
 execute body;
end $$;
drop function quizbox_market.attribute_legacy_by_node();
commit;
