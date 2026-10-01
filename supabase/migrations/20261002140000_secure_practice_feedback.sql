-- Requires targeted assignment recipients and the corrected attempt status contract.
begin;
create or replace function public.qb_can_access_learning_assessment(p_assessment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
select auth.uid() is not null and exists (
 select 1 from public.assessments a where a.id=p_assessment_id
 and (a.tenant_id=public.qb_public_tenant_id() or public.qb_is_tenant_member(a.tenant_id) or public.qb_is_platform_admin())
 and (
 public.qb_is_platform_admin() or a.owner_user_id=auth.uid()
 or (not exists(select 1 from public.assignments x where x.assessment_id=a.id) and coalesce(a.reference_type,'')<>'ASSIGNMENT')
 or exists(select 1 from public.assignments x join public.class_memberships m on m.class_id=x.class_id
 where x.assessment_id=a.id and x.status='published' and m.student_user_id=auth.uid() and m.status='active'
 and (x.recipient_mode='class' or exists(select 1 from public.assignment_targets t where t.assignment_id=x.id and t.membership_id=m.id and t.status='active')))
 ));
$$;
revoke all on function public.qb_can_access_learning_assessment(uuid) from public, anon;
grant execute on function public.qb_can_access_learning_assessment(uuid) to authenticated;

create or replace function public.qb_list_available_assessments()
returns table(id uuid,assessment_type text,subject_code text,subject_name text,grade text,question_count integer,difficulty text,time_limit_minutes integer,max_attempts integer,allow_resume boolean,auto_submit boolean,pass_percent numeric,opens_at timestamptz,expires_at timestamptz,instructions text,tenant_id uuid)
language sql stable security definer set search_path = '' as $$
 select a.id,a.assessment_type,a.subject_code,a.subject_name,a.grade::text,a.question_count,a.difficulty,a.time_limit_minutes,a.max_attempts,a.allow_resume,a.auto_submit,a.pass_percent,a.opens_at,a.expires_at,a.instructions,a.tenant_id
 from public.assessments a
 where public.qb_can_access_learning_assessment(a.id)
 and (a.opens_at is null or a.opens_at<=now()) and (a.expires_at is null or a.expires_at>now())
 and exists(select 1 from public.assessment_questions q where q.assessment_id=a.id)
 order by a.created_at desc;
$$;

-- Retain the deployed starter body and insert an authorization check before its first lookup.
do $$
declare body text; marker text := 'v_student_id :='; guard text := 'QB_ASSESSMENT_RECIPIENT_DENIED';
begin
 body := pg_get_functiondef('public.qb_start_attempt(uuid,uuid,uuid,text)'::regprocedure);
 if position(guard in body)=0 then
   if position(marker in body)=0 then raise exception 'UNRECOGNIZED_START_ATTEMPT_BODY'; end if;
   body := replace(body,marker,
   'if not public.qb_can_access_learning_assessment(p_assessment_id) then raise exception ''QB_ASSESSMENT_RECIPIENT_DENIED''; end if;
    ' || marker);
   execute body;
 end if;
end $$;

alter table public.assignment_targets enable row level security;
drop policy if exists assignment_targets_student_read on public.assignment_targets;
create policy assignment_targets_student_read on public.assignment_targets for select to authenticated
using (student_id=public.qb_current_student_id() and status='active');
drop policy if exists assignment_targets_teacher_read on public.assignment_targets;
create policy assignment_targets_teacher_read on public.assignment_targets for select to authenticated
using (public.qb_can_manage_class(class_id));
grant select on public.assignment_targets to authenticated;

create or replace function public.qb_attempt_mode(p_attempt_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare result text;
begin
 select coalesce(x.mode,a.assessment_type) into result
 from public.attempts t join public.assessments a on a.id=t.assessment_id
 left join public.assignments x on x.id=t.assignment_id
 where t.id=p_attempt_id and t.student_user_id=auth.uid();
 if not found then raise exception 'QB_ATTEMPT_OWNERSHIP_DENIED'; end if;
 return upper(result);
end $$;

create or replace function public.qb_save_practice_response(
 p_attempt_id uuid,p_question_id uuid,p_selected_answer text default null,
 p_selected_value jsonb default null,p_response_seconds integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.attempts; q public.assessment_questions; r public.responses; correct boolean; explain text; question_hint text;
begin
 select * into t from public.attempts where id=p_attempt_id for update;
 if t.id is null or auth.uid() is null or t.student_user_id is distinct from auth.uid() then raise exception 'QB_ATTEMPT_OWNERSHIP_DENIED'; end if;
 if t.status<>'in_progress' or (t.expires_at is not null and t.expires_at<=now()) then raise exception 'QB_ATTEMPT_NOT_ACTIVE'; end if;
 if public.qb_attempt_mode(p_attempt_id)<>'PRACTICE' then raise exception 'QB_PRACTICE_ONLY'; end if;
 if nullif(trim(p_selected_answer),'') is null and p_selected_value is null then raise exception 'QB_RESPONSE_REQUIRED'; end if;
 select * into q from public.assessment_questions where assessment_id=t.assessment_id and question_id=p_question_id;
 if not found then raise exception 'QB_QUESTION_NOT_IN_ATTEMPT'; end if;
 perform public.qb_save_response(p_attempt_id,p_question_id,p_selected_answer,p_selected_value,p_response_seconds);
 select * into r from public.responses where attempt_id=p_attempt_id and question_id=p_question_id;
 correct := coalesce(public.qb_grade_response(q.answer_type_snapshot,q.correct_answer_snapshot,q.answer_spec_snapshot,r.selected_answer,r.selected_value),false);
 update public.responses set is_correct=correct,marks_awarded=case when correct then coalesce(q.marks_snapshot,1) else 0 end where id=r.id;
 select explanation,hint into explain,question_hint from public.questions where id=p_question_id;
 return jsonb_build_object('question_id',p_question_id,'is_correct',correct,'selected_answer',r.selected_answer,'selected_value',r.selected_value,
 'correct_answer',coalesce(q.correct_answer_snapshot,q.answer_spec_snapshot->>'value',q.answer_spec_snapshot->>'canonical',(q.answer_spec_snapshot->'correct_options')::text,(q.answer_spec_snapshot->'accepted')::text),
 'explanation',explain,'hint',question_hint,'marks_awarded',case when correct then coalesce(q.marks_snapshot,1) else 0 end);
end $$;
revoke all on function public.qb_attempt_mode(uuid), public.qb_save_practice_response(uuid,uuid,text,jsonb,integer) from public,anon;
grant execute on function public.qb_attempt_mode(uuid), public.qb_save_practice_response(uuid,uuid,text,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
