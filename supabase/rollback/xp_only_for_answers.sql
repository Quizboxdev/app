-- Rollback for 20261120120000_xp_only_for_answers.sql: puts back the unconditional 20-point completion bonus (even when nothing was answered). One transaction.
begin;
do $rollback$
declare
  def text;
  old_line constant text := $q$  insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'ASSIGNMENT_COMPLETION',20,'{}') on conflict(attempt_id,reason) do nothing;$q$;
  new_text constant text := $q$  -- Reward follows the answers given (December gate MB-04): nothing answered earns nothing; the completion bonus is the share of the paper answered (20 points for a full paper).
  if coalesce(v_attempt.answered_count,0) > 0 then
    insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata)
    values(v_attempt.student_user_id,v_attempt.id,'ASSIGNMENT_COMPLETION',
      greatest(1, round(20.0 * v_attempt.answered_count / greatest(coalesce(v_attempt.answered_count,0) + coalesce(v_attempt.unanswered_count,0), 1))::integer),'{}')
    on conflict(attempt_id,reason) do nothing;
  end if;$q$;
begin
  select pg_get_functiondef('quizbox_private.core_qb_complete_attempt(uuid,text)'::regprocedure) into def;
  if position(new_text in def) = 0 then return; end if;
  execute replace(def, new_text, old_line);
end
$rollback$;
commit;
