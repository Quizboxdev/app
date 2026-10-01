-- Keep the existing XP formula while avoiding forbidden zero-point rows.
begin;
do $$
declare body text; award text := 'insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,''CORRECT_ANSWER'',coalesce(v_attempt.correct_count,0)*5,''{}'') on conflict(attempt_id,reason) do nothing;';
begin
 body := pg_get_functiondef('public.qb_complete_attempt(uuid,text)'::regprocedure);
 if position('QB_SKIP_ZERO_XP' in body)=0 then
   if position(award in body)=0 then raise exception 'UNRECOGNIZED_XP_AWARD_BODY'; end if;
   body := replace(body,award,'-- QB_SKIP_ZERO_XP: zero-point awards are no-ops under the existing table constraint.
   if coalesce(v_attempt.correct_count,0)>0 then ' || award || ' end if;');
   execute body;
 end if;
end $$;
do $$
declare body text;
begin
 body := pg_get_functiondef('public.qb_save_practice_response(uuid,uuid,text,jsonb,integer)'::regprocedure);
 body := replace(body,'public.qb_attempt_mode(p_attempt_id)<>''PRACTICE''','public.qb_attempt_mode(p_attempt_id) is distinct from ''PRACTICE''');
 execute body;
end $$;
notify pgrst,'reload schema';
commit;
