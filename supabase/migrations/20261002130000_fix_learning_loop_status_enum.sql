begin;

create or replace function public.qb_complete_attempt(p_attempt_id uuid, p_submission_reason text default 'student_submit')
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_attempt public.attempts; v_result jsonb; v_xp integer := 0;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.student_user_id <> auth.uid() then raise exception 'ATTEMPT_ACCESS_DENIED'; end if;
  if v_attempt.status not in ('submitted','expired') then
    select public.qb_submit_attempt(p_attempt_id,p_submission_reason) into v_result;
  end if;
  select * into v_attempt from public.attempts where id = p_attempt_id;

  insert into public.learning_events(student_user_id,class_id,assignment_id,attempt_id,response_id,question_id,curriculum_node_id,mode,is_correct,difficulty,response_seconds,hint_used,attempt_number,occurred_at)
  select v_attempt.student_user_id,v_attempt.class_id,v_attempt.assignment_id,v_attempt.id,r.id,r.question_id,q.curriculum_node_id,coalesce(a.mode,'ASSESSMENT'),r.is_correct,coalesce(q.difficulty_code,q.difficulty_label),coalesce(r.response_seconds,0),false,1,coalesce(r.finalized_at,r.answered_at,now())
  from public.responses r join public.questions q on q.id=r.question_id left join public.assignments a on a.id=v_attempt.assignment_id
  where r.attempt_id=v_attempt.id on conflict(response_id) do nothing;

  with aggregates as (select le.curriculum_node_id,count(*) n,avg(case when le.is_correct then 100 else 0 end) historical,avg(case when le.is_correct then case lower(coalesce(le.difficulty,'')) when 'hard' then 100 when 'medium' then 85 else 70 end else 0 end) difficulty,greatest(0,100-coalesce(stddev_pop(case when le.is_correct then 100 else 0 end),0)) consistency,avg(case when le.hint_used then 0 else 100 end) independence from public.learning_events le where le.student_user_id=v_attempt.student_user_id and le.curriculum_node_id is not null group by le.curriculum_node_id), recent as (select curriculum_node_id,avg(case when is_correct then 100 else 0 end) recent from (select le.*,row_number() over(partition by curriculum_node_id order by occurred_at desc) rn from public.learning_events le where student_user_id=v_attempt.student_user_id and curriculum_node_id is not null) x where rn<=10 group by curriculum_node_id), scored as (select a.*,r.recent,round((r.recent*.40+a.historical*.20+a.difficulty*.15+a.consistency*.15+a.independence*.10)::numeric,2) score from aggregates a join recent r using(curriculum_node_id))
  insert into public.mastery_records(student_user_id,curriculum_node_id,mastery_score,proficiency_state,confidence,attempts_count,recent_accuracy,historical_accuracy,difficulty_adjusted,consistency,independence,last_practiced_at,updated_at)
  select v_attempt.student_user_id,curriculum_node_id,score,case when score>=85 and n>=4 then 'Mastered' when score>=68 then 'Proficient' when score>=40 then 'Developing' else 'Learning' end,case when n>=10 then 'high' when n>=4 then 'medium' else 'low' end,n,recent,historical,difficulty,consistency,independence,now(),now() from scored
  on conflict(student_user_id,curriculum_node_id) do update set mastery_score=excluded.mastery_score,proficiency_state=excluded.proficiency_state,confidence=excluded.confidence,attempts_count=excluded.attempts_count,recent_accuracy=excluded.recent_accuracy,historical_accuracy=excluded.historical_accuracy,difficulty_adjusted=excluded.difficulty_adjusted,consistency=excluded.consistency,independence=excluded.independence,last_practiced_at=now(),updated_at=now();

  insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'CORRECT_ANSWER',coalesce(v_attempt.correct_count,0)*5,'{}') on conflict(attempt_id,reason) do nothing;
  insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'ASSIGNMENT_COMPLETION',20,'{}') on conflict(attempt_id,reason) do nothing;
  if coalesce(v_attempt.percentage,0)>=80 then insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'HIGH_PROFICIENCY',25,'{}') on conflict(attempt_id,reason) do nothing; end if;
  select coalesce(sum(points),0) into v_xp from public.xp_transactions where attempt_id=v_attempt.id;
  return jsonb_build_object('attempt_id',v_attempt.id,'score',v_attempt.score,'total_marks',v_attempt.total_marks,'percentage',v_attempt.percentage,'correct',v_attempt.correct_count,'incorrect',v_attempt.incorrect_count,'unanswered',v_attempt.unanswered_count,'proficiency',public.qb_proficiency(v_attempt.percentage),'xp_earned',v_xp,'status',v_attempt.status);
end $$;

grant execute on function public.qb_complete_attempt(uuid,text) to authenticated;
commit;
