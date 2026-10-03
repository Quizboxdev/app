-- Read-only schema/function export, 2026-10-02. Existing learning completion engine.
create table public.learning_events (id uuid not null default gen_random_uuid(), student_user_id uuid not null, class_id uuid, assignment_id uuid, attempt_id uuid not null, response_id uuid not null, question_id uuid not null, curriculum_node_id uuid, mode text not null, is_correct boolean, difficulty text, response_seconds integer not null default 0, hint_used boolean not null default false, attempt_number integer not null default 1, occurred_at timestamp with time zone not null default now());
create table public.mastery_records (id uuid not null default gen_random_uuid(), student_user_id uuid not null, curriculum_node_id uuid not null, mastery_score numeric(5,2) not null default 0, proficiency_state text not null default 'Not Started'::text, confidence text not null default 'low'::text, attempts_count integer not null default 0, recent_accuracy numeric(5,2) not null default 0, historical_accuracy numeric(5,2) not null default 0, difficulty_adjusted numeric(5,2) not null default 0, consistency numeric(5,2) not null default 0, independence numeric(5,2) not null default 0, last_practiced_at timestamp with time zone, updated_at timestamp with time zone not null default now());
create table public.xp_transactions (id uuid not null default gen_random_uuid(), student_user_id uuid not null, attempt_id uuid, reason text not null, points integer not null, metadata jsonb not null default '{}'::jsonb, created_at timestamp with time zone not null default now());
alter table public.learning_events add constraint learning_events_mode_check CHECK ((mode = ANY (ARRAY['PRACTICE'::text, 'ASSESSMENT'::text])));
alter table public.learning_events add constraint learning_events_pkey PRIMARY KEY (id);
alter table public.learning_events add constraint learning_events_response_id_key UNIQUE (response_id);
alter table public.mastery_records add constraint mastery_records_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
alter table public.mastery_records add constraint mastery_records_mastery_score_check CHECK (((mastery_score >= (0)::numeric) AND (mastery_score <= (100)::numeric)));
alter table public.mastery_records add constraint mastery_records_pkey PRIMARY KEY (id);
alter table public.mastery_records add constraint mastery_records_proficiency_state_check CHECK ((proficiency_state = ANY (ARRAY['Not Started'::text, 'Learning'::text, 'Developing'::text, 'Proficient'::text, 'Mastered'::text, 'Needs Review'::text])));
alter table public.mastery_records add constraint mastery_records_student_user_id_curriculum_node_id_key UNIQUE (student_user_id, curriculum_node_id);
alter table public.xp_transactions add constraint xp_transactions_attempt_id_reason_key UNIQUE (attempt_id, reason);
alter table public.xp_transactions add constraint xp_transactions_pkey PRIMARY KEY (id);
alter table public.xp_transactions add constraint xp_transactions_points_check CHECK ((points <> 0));
alter table public.xp_transactions add constraint xp_transactions_reason_check CHECK ((reason = ANY (ARRAY['CORRECT_ANSWER'::text, 'ASSIGNMENT_COMPLETION'::text, 'HIGH_PROFICIENCY'::text, 'ADMIN_ADJUSTMENT'::text])));
CREATE OR REPLACE FUNCTION public.qb_attempt_mode(p_attempt_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result text;
begin
 select coalesce(x.mode,a.assessment_type) into result
 from public.attempts t join public.assessments a on a.id=t.assessment_id
 left join public.assignments x on x.id=t.assignment_id
 where t.id=p_attempt_id and t.student_user_id=auth.uid();
 if not found then raise exception 'QB_ATTEMPT_OWNERSHIP_DENIED'; end if;
 return upper(result);
end $function$;
CREATE OR REPLACE FUNCTION public.qb_proficiency(p_percentage numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_percentage >= 80 then 'Highly Proficient'
    when p_percentage >= 68 then 'Proficient'
    when p_percentage >= 54 then 'Approaching Proficiency'
    when p_percentage >= 40 then 'Developing'
    else 'Emerging'
  end
$function$;
CREATE OR REPLACE FUNCTION quizbox_private.core_qb_complete_attempt(p_attempt_id uuid, p_submission_reason text DEFAULT 'student_submit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_attempt public.attempts; v_result jsonb; v_xp integer := 0;
begin
 
 if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED'; end if;
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.student_user_id is distinct from auth.uid() then raise exception 'ATTEMPT_ACCESS_DENIED'; end if;
  if v_attempt.status not in ('submitted','expired') then
    select quizbox_private.core_qb_submit_attempt(p_attempt_id,p_submission_reason) into v_result;
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

  -- QB_SKIP_ZERO_XP: zero-point awards are no-ops under the existing table constraint.
   if coalesce(v_attempt.correct_count,0)>0 then insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'CORRECT_ANSWER',coalesce(v_attempt.correct_count,0)*5,'{}') on conflict(attempt_id,reason) do nothing; end if;
  insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'ASSIGNMENT_COMPLETION',20,'{}') on conflict(attempt_id,reason) do nothing;
  if coalesce(v_attempt.percentage,0)>=80 then insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'HIGH_PROFICIENCY',25,'{}') on conflict(attempt_id,reason) do nothing; end if;
  select coalesce(sum(points),0) into v_xp from public.xp_transactions where attempt_id=v_attempt.id;
  return jsonb_build_object('attempt_id',v_attempt.id,'score',v_attempt.score,'total_marks',v_attempt.total_marks,'percentage',v_attempt.percentage,'correct',v_attempt.correct_count,'incorrect',v_attempt.incorrect_count,'unanswered',v_attempt.unanswered_count,'proficiency',public.qb_proficiency(v_attempt.percentage),'xp_earned',v_xp,'status',v_attempt.status);
end $function$;
CREATE OR REPLACE FUNCTION public.qb_complete_attempt(p_attempt_id uuid, p_submission_reason text DEFAULT 'student_submit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
   declare failure text;
   begin
    if not quizbox_private.consume_budget('qb_complete_attempt',30,60) then
     perform set_config('response.status','429',true);
     return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
    end if;
    begin
     return quizbox_private.core_qb_complete_attempt(p_attempt_id,p_submission_reason);
    exception when others then
     failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
     perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
     return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
    end;
   end $function$;
