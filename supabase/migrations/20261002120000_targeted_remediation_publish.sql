begin;

-- Extend the existing publisher; assignment_targets remains the normalized recipient store.
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
  p_due_at timestamptz default null,
  p_target_student_ids uuid[] default null,
  p_remediation_source_assignment_id uuid default null,
  p_remediation_node_id uuid default null
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

  insert into public.assignments(assessment_id,class_id,teacher_id,teacher_user_id,subject_code,subject_name,grade,title,recipient_mode,question_count,difficulty,due_at,time_limit_minutes,attempts_allowed,instructions,status,published_at,tenant_id,curriculum_node_ids,mode,selection_mode,remediation_source_assignment_id,remediation_node_id)
  values (v_assessment.id,v_class.id,v_teacher,auth.uid(),v_assessment.subject_code,v_assessment.subject_name,v_class.grade,p_title,(case when p_target_student_ids is null then 'class' else 'selected' end)::public.recipient_mode,p_question_count,coalesce(p_difficulty,'mixed'),p_due_at,p_time_limit_minutes,p_attempts_allowed,p_description,'published',now(),v_class.tenant_id,p_curriculum_node_ids,upper(p_mode),upper(p_selection_mode),p_remediation_source_assignment_id,p_remediation_node_id)
  returning * into v_assignment;
  update public.assessments set reference_id = v_assignment.id where id = v_assessment.id;

  insert into public.assessment_questions(assessment_id,question_id,question_order,question_text_snapshot,option_a_snapshot,option_b_snapshot,option_c_snapshot,option_d_snapshot,correct_answer_snapshot,marks_snapshot,question_content_snapshot,answer_type_snapshot,answer_spec_snapshot)
  select v_assessment.id,q.id,row_number() over(order by q.id),q.question_text,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_answer,q.marks,q.question_content,q.answer_type,q.answer_spec from qb_selected_questions q;
  insert into public.assignment_question_versions(assignment_id,question_id,question_version,display_order,marks)
  select v_assignment.id,q.id,q.version,row_number() over(order by q.id),q.marks from qb_selected_questions q;
  insert into public.assignment_targets(assignment_id,class_id,student_id,membership_id,status)
  select v_assignment.id,v_class.id,cm.student_id,cm.id,'ACTIVE'
  from public.class_memberships cm
  where cm.class_id = v_class.id and cm.status = 'active'
    and (p_target_student_ids is null or cm.student_user_id = any(p_target_student_ids))
  on conflict do nothing;
  return jsonb_build_object('assignment_id',v_assignment.id,'assessment_id',v_assessment.id,'question_count',v_available,'recipient_mode',v_assignment.recipient_mode,'status','PUBLISHED');
end $$;

grant execute on function public.qb_publish_assignment(uuid,text,text,uuid[],integer,text,text,uuid[],text,integer,integer,timestamptz,timestamptz,uuid[],uuid,uuid) to authenticated;
commit;
