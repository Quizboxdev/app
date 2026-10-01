begin;

create or replace function public.qb_publish_assignment(
  p_class_id uuid,
  p_title text,
  p_description text,
  p_curriculum_node_ids uuid[],
  p_question_count integer,
  p_difficulty text default null,
  p_selection_mode text default 'AUTOMATIC',
  p_question_ids uuid[] default null,
  p_mode text default 'ASSESSMENT',
  p_attempts_allowed integer default 1,
  p_time_limit_minutes integer default 30,
  p_start_at timestamptz default now(),
  p_due_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_class public.classes;
  v_teacher uuid;
  v_assessment public.assessments;
  v_assignment public.assignments;
  v_available integer;
begin
  if p_question_count < 1 or p_question_count > 100 then raise exception 'INVALID_QUESTION_COUNT'; end if;
  if p_attempts_allowed < 1 or p_time_limit_minutes < 1 then raise exception 'INVALID_ASSIGNMENT_LIMITS'; end if;
  select * into v_class from public.classes where id = p_class_id;
  if v_class.id is null then raise exception 'CLASS_NOT_FOUND'; end if;
  if not (v_class.teacher_user_id = auth.uid() or public.qb_can_manage_class(v_class.id)) then raise exception 'CLASS_ACCESS_DENIED'; end if;
  v_teacher := public.qb_current_teacher_id();
  if v_teacher is null then raise exception 'TEACHER_PROFILE_REQUIRED'; end if;

  create temporary table qb_selected_questions on commit drop as
  select q.* from public.questions q
  where q.status = 'active'
    and lower(coalesce(q.validation_status,'')) in ('approved','validated')
    and q.curriculum_node_id = any(p_curriculum_node_ids)
    and (p_difficulty is null or lower(coalesce(q.difficulty_code,q.difficulty_label,'')) = lower(p_difficulty))
    and (upper(p_selection_mode) <> 'MANUAL' or q.id = any(coalesce(p_question_ids,'{}'::uuid[])))
  order by case when upper(p_selection_mode) = 'AUTOMATIC' then random() else 0 end
  limit p_question_count;
  select count(*) into v_available from qb_selected_questions;
  if v_available < p_question_count then raise exception 'INSUFFICIENT_APPROVED_QUESTIONS:%/%', v_available, p_question_count; end if;

  insert into public.assessments(assessment_type,owner_role,owner_user_id,subject_code,subject_name,grade,question_count,difficulty,time_limit_minutes,max_attempts,allow_resume,auto_submit,pass_percent,opens_at,expires_at,instructions,tenant_id,reference_type)
  values (upper(p_mode),'teacher',auth.uid(),coalesce(v_class.subject_node_id::text,'CURRICULUM'),'Curriculum Assignment',v_class.grade,p_question_count,coalesce(p_difficulty,'mixed'),p_time_limit_minutes,p_attempts_allowed,true,true,40,p_start_at,p_due_at,p_description,v_class.tenant_id,'ASSIGNMENT')
  returning * into v_assessment;

  insert into public.assignments(assessment_id,class_id,teacher_id,teacher_user_id,subject_code,subject_name,grade,title,recipient_mode,question_count,difficulty,due_at,time_limit_minutes,attempts_allowed,instructions,status,published_at,tenant_id,curriculum_node_ids,mode,selection_mode)
  values (v_assessment.id,v_class.id,v_teacher,auth.uid(),v_assessment.subject_code,v_assessment.subject_name,v_class.grade,p_title,'CLASS',p_question_count,coalesce(p_difficulty,'mixed'),p_due_at,p_time_limit_minutes,p_attempts_allowed,p_description,'PUBLISHED',now(),v_class.tenant_id,p_curriculum_node_ids,upper(p_mode),upper(p_selection_mode))
  returning * into v_assignment;
  update public.assessments set reference_id = v_assignment.id where id = v_assessment.id;

  insert into public.assessment_questions(assessment_id,question_id,question_order,question_text_snapshot,option_a_snapshot,option_b_snapshot,option_c_snapshot,option_d_snapshot,correct_answer_snapshot,marks_snapshot,question_content_snapshot,answer_type_snapshot,answer_spec_snapshot)
  select v_assessment.id,q.id,row_number() over(order by q.id),q.question_text,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_answer,q.marks,q.question_content,q.answer_type,q.answer_spec
  from qb_selected_questions q;
  insert into public.assignment_question_versions(assignment_id,question_id,question_version,display_order,marks)
  select v_assignment.id,q.id,q.version,row_number() over(order by q.id),q.marks from qb_selected_questions q;
  insert into public.assignment_targets(assignment_id,class_id,student_id,membership_id,status)
  select v_assignment.id,v_class.id,cm.student_id,cm.id,'ACTIVE' from public.class_memberships cm where cm.class_id = v_class.id and upper(cm.status) = 'ACTIVE'
  on conflict do nothing;
  return jsonb_build_object('assignment_id',v_assignment.id,'assessment_id',v_assessment.id,'question_count',v_available,'status','PUBLISHED');
end $$;

create or replace function public.qb_complete_attempt(p_attempt_id uuid, p_submission_reason text default 'student_submit')
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_attempt public.attempts; v_result jsonb; v_xp integer := 0;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.student_user_id <> auth.uid() then raise exception 'ATTEMPT_ACCESS_DENIED'; end if;
  if upper(v_attempt.status) not in ('SUBMITTED','COMPLETED','GRADED') then
    select public.qb_submit_attempt(p_attempt_id,p_submission_reason) into v_result;
  end if;
  select * into v_attempt from public.attempts where id = p_attempt_id;

  insert into public.learning_events(student_user_id,class_id,assignment_id,attempt_id,response_id,question_id,curriculum_node_id,mode,is_correct,difficulty,response_seconds,hint_used,attempt_number,occurred_at)
  select v_attempt.student_user_id,v_attempt.class_id,v_attempt.assignment_id,v_attempt.id,r.id,r.question_id,q.curriculum_node_id,coalesce(a.mode,'ASSESSMENT'),r.is_correct,coalesce(q.difficulty_code,q.difficulty_label),coalesce(r.response_seconds,0),false,1,coalesce(r.finalized_at,r.answered_at,now())
  from public.responses r join public.questions q on q.id=r.question_id left join public.assignments a on a.id=v_attempt.assignment_id
  where r.attempt_id=v_attempt.id on conflict(response_id) do nothing;

  with aggregates as (
    select le.curriculum_node_id,count(*) n,avg(case when le.is_correct then 100 else 0 end) historical,
      avg(case when le.is_correct then case lower(coalesce(le.difficulty,'')) when 'hard' then 100 when 'medium' then 85 else 70 end else 0 end) difficulty,
      greatest(0,100-coalesce(stddev_pop(case when le.is_correct then 100 else 0 end),0)) consistency,
      avg(case when le.hint_used then 0 else 100 end) independence
    from public.learning_events le where le.student_user_id=v_attempt.student_user_id and le.curriculum_node_id is not null group by le.curriculum_node_id
  ), recent as (
    select curriculum_node_id,avg(case when is_correct then 100 else 0 end) recent from (select le.*,row_number() over(partition by curriculum_node_id order by occurred_at desc) rn from public.learning_events le where student_user_id=v_attempt.student_user_id and curriculum_node_id is not null) x where rn<=10 group by curriculum_node_id
  ), scored as (
    select a.*,r.recent,round((r.recent*.40+a.historical*.20+a.difficulty*.15+a.consistency*.15+a.independence*.10)::numeric,2) score from aggregates a join recent r using(curriculum_node_id)
  )
  insert into public.mastery_records(student_user_id,curriculum_node_id,mastery_score,proficiency_state,confidence,attempts_count,recent_accuracy,historical_accuracy,difficulty_adjusted,consistency,independence,last_practiced_at,updated_at)
  select v_attempt.student_user_id,curriculum_node_id,score,case when score>=85 and n>=4 then 'Mastered' when score>=68 then 'Proficient' when score>=40 then 'Developing' else 'Learning' end,case when n>=10 then 'high' when n>=4 then 'medium' else 'low' end,n,recent,historical,difficulty,consistency,independence,now(),now() from scored
  on conflict(student_user_id,curriculum_node_id) do update set mastery_score=excluded.mastery_score,proficiency_state=excluded.proficiency_state,confidence=excluded.confidence,attempts_count=excluded.attempts_count,recent_accuracy=excluded.recent_accuracy,historical_accuracy=excluded.historical_accuracy,difficulty_adjusted=excluded.difficulty_adjusted,consistency=excluded.consistency,independence=excluded.independence,last_practiced_at=excluded.last_practiced_at,updated_at=now();

  insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'CORRECT_ANSWER',coalesce(v_attempt.correct_count,0)*5,'{}') on conflict(attempt_id,reason) do nothing;
  insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'ASSIGNMENT_COMPLETION',20,'{}') on conflict(attempt_id,reason) do nothing;
  if coalesce(v_attempt.percentage,0)>=80 then insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'HIGH_PROFICIENCY',25,'{}') on conflict(attempt_id,reason) do nothing; end if;
  select coalesce(sum(points),0) into v_xp from public.xp_transactions where attempt_id=v_attempt.id;
  return jsonb_build_object('attempt_id',v_attempt.id,'score',v_attempt.score,'total_marks',v_attempt.total_marks,'percentage',v_attempt.percentage,'correct',v_attempt.correct_count,'incorrect',v_attempt.incorrect_count,'unanswered',v_attempt.unanswered_count,'proficiency',public.qb_proficiency(v_attempt.percentage),'xp_earned',v_xp,'status',v_attempt.status);
end $$;

grant execute on function public.qb_publish_assignment(uuid,text,text,uuid[],integer,text,text,uuid[],text,integer,integer,timestamptz,timestamptz) to authenticated;
grant execute on function public.qb_complete_attempt(uuid,text) to authenticated;
commit;
