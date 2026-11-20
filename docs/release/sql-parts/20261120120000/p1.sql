-- December 2026 release-readiness gate, MB-04: people merit what they answer.
-- Before: finishing or timing out a paper paid the 20-point completion bonus even when nothing had been answered.
-- Now: no completion points when no question was answered; otherwise the bonus is the share of the paper answered (round(20 x answered / questions), at least 1).
-- Correct-answer points (5 each) and the high-proficiency bonus (80 % or more) are unchanged; both already need correct answers. Existing rewards are not touched.
-- Method: the one reward line of quizbox_private.core_qb_complete_attempt is replaced inside the LIVE definition (read from the database, not copied), so nothing else in
-- that function can drift. If the line is not found the migration stops with XP_LINE_NOT_FOUND and changes nothing. Applying it twice does nothing the second time.
-- Rollback: supabase/rollback/xp_only_for_answers.sql.
begin;
do $migration$
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
  if position('share of the paper answered' in def) > 0 then return; end if;
  if position(old_line in def) = 0 then raise exception 'XP_LINE_NOT_FOUND'; end if;
  execute replace(def, old_line, new_text);
end
$migration$;
commit;
