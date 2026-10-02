-- Close default-public RPC grants without replacing the accepted learning engine.
-- Ordered after the accepted factory migrations; reconcile live deployment receipts.
create schema if not exists quizbox_private;
revoke all on schema quizbox_private from public, anon, authenticated;

create or replace function public.qb_current_role() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select upper(role::text) from public.profiles where id=auth.uid() and status='active'),'');
$$;
create or replace function public.qb_tenant_role(p_tenant_id uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select upper(role) from public.tenant_memberships where tenant_id=p_tenant_id and user_id=auth.uid() and upper(status)='ACTIVE' limit 1),'');
$$;

create table quizbox_private.operation_budgets(
 actor_id uuid not null, operation text not null, window_start timestamptz not null,
 used integer not null check(used>0), primary key(actor_id,operation,window_start)
);
alter table quizbox_private.operation_budgets enable row level security;
create function quizbox_private.consume_budget(p_operation text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; w timestamptz;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 w:=to_timestamp(floor(extract(epoch from clock_timestamp())/p_seconds)*p_seconds);
 insert into quizbox_private.operation_budgets values(auth.uid(),p_operation,w,1)
 on conflict(actor_id,operation,window_start) do update set used=quizbox_private.operation_budgets.used+1 returning used into n;
 return n<=p_limit;
end $$;
create function quizbox_private.enforce_budget(p_operation text,p_limit integer,p_seconds integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not quizbox_private.consume_budget(p_operation,p_limit,p_seconds) then raise exception 'QB_RATE_LIMITED'; end if;
end $$;

create function quizbox_private.provision_student(p_user uuid,p_grade text) returns void
language plpgsql security definer set search_path='' as $$
declare u auth.users; r text; t uuid;
begin
 select * into u from auth.users where id=p_user;
 if u.id is null then raise exception 'AUTH_REQUIRED'; end if;
 -- Reserved fixture identities can never be bootstrapped by public signup.
 if lower(u.email) like '%@quizbox.local' and not exists(select 1 from public.profiles where id=p_user) then
  raise exception 'QB_RESERVED_TEST_IDENTITY';
 end if;
 if p_grade is null or not exists(select 1 from pg_enum where enumtypid='public.qb_grade'::regtype and enumlabel=p_grade) then raise exception 'QB_GRADE_REQUIRED'; end if;
 insert into public.profiles(id,role,full_name,email,status)
 values(u.id,'student',coalesce(nullif(left(u.raw_user_meta_data->>'full_name',150),''),'Learner'),u.email,'active')
 on conflict(id) do nothing;
 select role::text into r from public.profiles where id=u.id;
 if r<>'student' then return; end if;
 insert into public.student_profiles(user_id,grade,status) values(u.id,p_grade::public.qb_grade,'active') on conflict(user_id) do nothing;
 t:=public.qb_public_tenant_id();
 if t is not null then
  insert into public.tenant_memberships(tenant_id,user_id,role,status) values(t,u.id,'MEMBER','ACTIVE') on conflict(tenant_id,user_id) do nothing;
 end if;
end $$;
create function quizbox_private.on_signup() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform quizbox_private.provision_student(new.id,new.raw_user_meta_data->>'grade');
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details)
 values(new.id,'QB_OP_SIGNUP','profiles',new.id,'pass','{"origin":"database"}');
 return new;
end $$;
create trigger quizbox_signup_profile after insert on auth.users for each row execute function quizbox_private.on_signup();
create function public.qb_provision_my_profile(p_grade text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform quizbox_private.provision_student(auth.uid(),p_grade);
 return jsonb_build_object('status','PASS','role',public.qb_current_role());
end $$;

-- Successful operational writes are recorded without answers, specifications or credentials.
create function quizbox_private.audit_operation() returns trigger language plpgsql security definer set search_path='' as $$
declare event text; row_data jsonb:=to_jsonb(new); old_data jsonb; d jsonb;
begin
 if tg_op='UPDATE' then old_data:=to_jsonb(old); end if;
 event:=case tg_table_name
 when 'classes' then 'CLASS_CREATED' when 'class_memberships' then 'CLASS_JOINED'
 when 'assignments' then case when row_data->>'remediation_node_id' is not null then 'REMEDIATION_PUBLISHED' else 'ASSIGNMENT_PUBLISHED' end
 when 'attempts' then case when tg_op='INSERT' then 'ATTEMPT_STARTED' else 'ATTEMPT_COMPLETED' end
 when 'assessment_results' then 'RESULT_PERSISTED'
 when 'questions' then case row_data->>'validation_status' when 'approved' then 'REVIEW_APPROVED' when 'rejected' then 'REVIEW_REJECTED' else 'QUESTION_REVISED' end
 when 'content_import_batches' then case when row_data->>'provider'='not-configured' then 'GENERATION_REQUESTED' else 'QUESTION_IMPORT' end end;
 if tg_table_name='assignments' and row_data->>'status'<>'published' then return new; end if;
 if tg_table_name='attempts' and tg_op='UPDATE' and (row_data->>'submitted_at' is null or old_data->>'submitted_at' is not null) then return new; end if;
 if tg_table_name='questions' and tg_op='UPDATE' and old_data->>'validation_status' is not distinct from row_data->>'validation_status' and old_data->>'version' is not distinct from row_data->>'version' then return new; end if;
 d:=jsonb_strip_nulls(jsonb_build_object('origin','database','tenant_id',row_data->>'tenant_id','class_id',row_data->>'class_id','version',row_data->>'version'));
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details)
 values(auth.uid(),'QB_OP_'||event,tg_table_name,(row_data->>'id')::uuid,'pass',d);
 return new;
end $$;
create trigger qb_ops_classes after insert on public.classes for each row execute function quizbox_private.audit_operation();
create trigger qb_ops_memberships after insert or update on public.class_memberships for each row execute function quizbox_private.audit_operation();
create trigger qb_ops_assignments after insert or update of status on public.assignments for each row execute function quizbox_private.audit_operation();
create trigger qb_ops_attempts after insert or update of submitted_at on public.attempts for each row execute function quizbox_private.audit_operation();
create trigger qb_ops_results after insert on public.assessment_results for each row execute function quizbox_private.audit_operation();
create trigger qb_ops_questions after insert or update on public.questions for each row execute function quizbox_private.audit_operation();
create trigger qb_ops_batches after insert on public.content_import_batches for each row execute function quizbox_private.audit_operation();

create function public.qb_operation_failure(p_operation text,p_code text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform quizbox_private.enforce_budget('failure_events',20,60);
 if p_operation not in ('ATTEMPT_COMPLETION','ATTEMPT_START','CLASS_JOIN','GENERATION','IMPORT','REVIEW') then raise exception 'QB_INVALID_EVENT'; end if;
 -- Client-origin failures are explicitly untrusted; only canonical codes are retained.
 insert into public.audit_logs(actor_user_id,action,status,details)
 values(auth.uid(),'QB_OP_'||p_operation,'fail',jsonb_build_object('origin','client','error_code',
 case when p_code in ('QB_RATE_LIMITED','QB_PERMISSION_DENIED','AUTH_REQUIRED','ATTEMPT_EXPIRED','INVALID_CLASS_CODE') then p_code else 'OPERATION_FAILED' end));
end $$;
create function public.qb_recent_operations(p_page integer default 1,p_failures_only boolean default true)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;
 if p_page is null or p_page<1 or p_page>1000 then raise exception 'QB_INVALID_PAGE'; end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(x) from(select id,actor_user_id,action,entity_type,entity_id,status,details,created_at from public.audit_logs where action like 'QB_OP_%' and (not p_failures_only or status='fail') order by created_at desc,id desc limit 50 offset (p_page-1)*50)x),'[]'::jsonb));
end $$;

create table public.content_coverage_targets(
 id uuid primary key default gen_random_uuid(), curriculum_id uuid not null references public.curricula(id),
 grade_code text not null default '', subject_code text not null default '',
 minimum integer not null check(minimum between 1 and 100), easy integer not null check(easy>=0),
 medium integer not null check(medium>=0), hard integer not null check(hard>=0),
 type_mix jsonb not null default '{"SINGLE_CHOICE":8,"TRUE_FALSE":2}',
 updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
 unique(curriculum_id,grade_code,subject_code), check(easy+medium+hard<=minimum)
);
alter table public.content_coverage_targets enable row level security;
create policy coverage_target_admin_read on public.content_coverage_targets for select to authenticated using(public.qb_is_platform_admin());
revoke all on public.content_coverage_targets from anon,authenticated;
grant select on public.content_coverage_targets to authenticated;
create function public.qb_save_coverage_target(p_curriculum_id uuid,p_grade text,p_subject text,p_minimum integer,p_easy integer,p_medium integer,p_hard integer,p_type_mix jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; n integer; item record;
begin
 if not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;
 perform quizbox_private.enforce_budget('coverage_targets',30,60);
 if p_grade is null or p_subject is null or p_minimum is null or p_easy is null or p_medium is null or p_hard is null or p_type_mix is null or jsonb_typeof(p_type_mix)<>'object' then raise exception 'QB_INVALID_TARGET'; end if;
 if not exists(select 1 from public.curriculum_nodes where curriculum_id=p_curriculum_id and (p_grade='' or canonical_grade_code=p_grade) and (p_subject='' or subject_code=p_subject)) then raise exception 'QB_INVALID_TARGET_SCOPE'; end if;
 n:=0;
 for item in select key,value from jsonb_each(p_type_mix) loop
  if item.key not in ('SINGLE_CHOICE','TRUE_FALSE','MULTIPLE_CHOICE','NUMERIC','FRACTION','SHORT_TEXT','EXPRESSION') or jsonb_typeof(item.value)<>'number' or item.value::text !~ '^[0-9]+$' then raise exception 'QB_INVALID_TYPE_MIX'; end if;
  n:=n+(item.value::text)::integer;
 end loop;
 if n>p_minimum then raise exception 'QB_INVALID_TYPE_MIX'; end if;
 insert into public.content_coverage_targets(curriculum_id,grade_code,subject_code,minimum,easy,medium,hard,type_mix,updated_by)
 values(p_curriculum_id,p_grade,p_subject,p_minimum,p_easy,p_medium,p_hard,p_type_mix,auth.uid())
 on conflict(curriculum_id,grade_code,subject_code) do update set minimum=excluded.minimum,easy=excluded.easy,medium=excluded.medium,hard=excluded.hard,type_mix=excluded.type_mix,updated_by=auth.uid(),updated_at=now() returning id into v_id;
 return v_id;
end $$;

create function public.qb_my_results_page(p_page integer default 1,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_page is null or p_page<1 or p_page>10000 or p_limit is null or p_limit<1 or p_limit>100 then raise exception 'QB_INVALID_PAGE'; end if;
 return jsonb_build_object('total',(select count(*) from public.assessment_results where student_user_id=auth.uid()),
 'rows',coalesce((select jsonb_agg(x) from(select * from public.assessment_results where student_user_id=auth.uid() order by submitted_at desc nulls last,id desc limit p_limit offset (p_page-1)*p_limit)x),'[]'::jsonb));
end $$;

create function public.qb_production_security_audit() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;
 return jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'name',p.proname,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'search_path',p.proconfig,'actor_guard',pg_get_functiondef(p.oid) ~ 'auth.uid|qb_is_|qb_can_|qb_has_|qb_current_|qb_assert_|enforce_budget','definition_hash',md5(pg_get_functiondef(p.oid)))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
 'signup_trigger',exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='quizbox_signup_profile'),
 'private_media',exists(select 1 from storage.buckets where id='question-media' and not public),
 'productionApproved',(select count(*) from public.questions where status='active' and validation_status='approved' and curriculum_node_id is not null and coalesce(source_type,'') not in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT')),
 'reviewQueue',(select count(*) from public.questions where validation_status='review'),
 'fixtureQuestions',(select count(*) from public.questions where source_type in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT')));
end $$;

-- Internal trigger/unsafe legacy detail functions are not browser APIs.
do $$
declare f record;
begin
 for f in select p.oid::regprocedure::text sig,p.proname,p.prorettype from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef loop
  execute 'revoke execute on function '||f.sig||' from public,anon,authenticated';
  execute 'grant execute on function '||f.sig||' to service_role';
  if f.prorettype not in ('trigger'::regtype,'event_trigger'::regtype) and f.proname not in ('qb_backend_acceptance','qb_get_question_options','qb_get_question_media') then
   execute 'grant execute on function '||f.sig||' to authenticated';
  end if;
  if f.proname='qb_marketplace_catalog' then execute 'grant execute on function '||f.sig||' to anon'; end if;
 end loop;
end $$;
revoke all on all functions in schema quizbox_private from public,anon,authenticated;
revoke all on all tables in schema quizbox_private from public,anon,authenticated;

-- Durable per-actor budgets survive multiple app instances; no shared-NAT penalty.
CREATE OR REPLACE FUNCTION public.qb_start_attempt(p_assessment_id uuid, p_assignment_id uuid, p_class_id uuid, p_client_session_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_student_id uuid;
    v_student_user_id uuid;

    v_assessment public.assessments%rowtype;
    v_existing public.attempts%rowtype;

    v_attempt_id uuid;
    v_now timestamptz := now();
    v_deadline timestamptz;

    v_existing_count integer;
    v_snapshot_count integer;

begin
 perform quizbox_private.enforce_budget('qb_start_attempt',10,60);
 if p_assessment_id is null or length(coalesce(p_client_session_id,''))>200 then raise exception 'QB_INVALID_ATTEMPT_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtext('qb_attempt:'||auth.uid()::text||':'||p_assessment_id::text));
 if exists(select 1 from public.assignments where assessment_id=p_assessment_id) then
  if not exists(select 1 from public.assignments a where a.assessment_id=p_assessment_id and a.id=p_assignment_id and a.class_id=p_class_id and a.status='published') then raise exception 'QB_ASSIGNMENT_CONTEXT_MISMATCH'; end if;
 elsif p_assignment_id is not null or p_class_id is not null then raise exception 'QB_ASSIGNMENT_CONTEXT_MISMATCH'; end if;

 if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED'; end if;

    if not public.qb_can_access_learning_assessment(p_assessment_id) then raise exception 'QB_ASSESSMENT_RECIPIENT_DENIED'; end if;
    v_student_id :=
        public.qb_current_student_id();

    v_student_user_id :=
        auth.uid();


    if v_student_id is null then
        raise exception 'QB_STUDENT_PROFILE_REQUIRED';
    end if;


    select *
    into v_assessment
    from public.assessments
    where id = p_assessment_id;


    if not found then
        raise exception 'QB_ASSESSMENT_NOT_FOUND';
    end if;


    if v_assessment.opens_at is not null
       and v_now < v_assessment.opens_at
    then
        raise exception 'QB_ASSESSMENT_NOT_OPEN';
    end if;


    if v_assessment.expires_at is not null
       and v_now >= v_assessment.expires_at
    then
        raise exception 'QB_ASSESSMENT_EXPIRED';
    end if;


    select count(*)
    into v_snapshot_count
    from public.assessment_questions
    where assessment_id = p_assessment_id;


    if v_snapshot_count = 0 then
        raise exception 'QB_ASSESSMENT_HAS_NO_SNAPSHOT';
    end if;


    select *
    into v_existing
    from public.attempts
    where assessment_id = p_assessment_id
      and student_id = v_student_id
      and status = 'in_progress'
    order by started_at desc
    limit 1;


    if found
       and coalesce(v_assessment.allow_resume,true)
       and (
           v_existing.expires_at is null
           or now() < v_existing.expires_at
       )
    then

        return jsonb_build_object(
            'status','PASS',
            'resumed',true,
            'attempt_id',v_existing.id
        );

    end if;


    select count(*)
    into v_existing_count
    from public.attempts
    where assessment_id = p_assessment_id
      and student_id = v_student_id;


    if v_existing_count >= greatest(v_assessment.max_attempts,1) then
        raise exception 'QB_MAX_ATTEMPTS_REACHED';
    end if;


    v_deadline :=
        v_now +
        make_interval(
            mins => greatest(
                v_assessment.time_limit_minutes,
                1
            )
        );


    if v_assessment.expires_at is not null
       and v_deadline > v_assessment.expires_at
    then
        v_deadline := v_assessment.expires_at;
    end if;


    insert into public.attempts (
        assignment_id,
        assessment_id,
        class_id,

        student_id,
        student_user_id,

        started_at,
        expires_at,

        status,

        tenant_id,
        deadline_at,
        last_activity_at,

        pass_percent,
        client_session_id
    )
    values (
        p_assignment_id,
        p_assessment_id,
        p_class_id,

        v_student_id,
        v_student_user_id,

        v_now,
        v_deadline,

        'in_progress',

        v_assessment.tenant_id,
        v_deadline,
        v_now,

        v_assessment.pass_percent,
        p_client_session_id
    )

    returning id
    into v_attempt_id;


    return jsonb_build_object(
        'status','PASS',
        'resumed',false,
        'attempt_id',v_attempt_id,
        'deadline_at',v_deadline,
        'question_count',v_snapshot_count
    );

end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_save_response(p_attempt_id uuid, p_question_id uuid, p_selected_answer text DEFAULT NULL::text, p_selected_value jsonb DEFAULT NULL::jsonb, p_response_seconds integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_attempt public.attempts%rowtype;
    v_student_id uuid;

begin
 perform quizbox_private.enforce_budget('qb_save_response',180,60);
 if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED'; end if;

    v_student_id :=
        public.qb_current_student_id();


    select *
    into v_attempt
    from public.attempts
    where id = p_attempt_id
    for update;


    if not found then
        raise exception 'QB_ATTEMPT_NOT_FOUND';
    end if;


    if v_attempt.student_id is distinct from v_student_id then
        raise exception 'QB_ATTEMPT_OWNERSHIP_DENIED';
    end if;


    if v_attempt.status <> 'in_progress' then
        raise exception 'QB_ATTEMPT_NOT_ACTIVE';
    end if;


    if v_attempt.expires_at is not null
       and now() >= v_attempt.expires_at
    then
        raise exception 'QB_ATTEMPT_TIME_EXPIRED';
    end if;


    if not exists (
        select 1
        from public.assessment_questions aq
        where aq.assessment_id = v_attempt.assessment_id
          and aq.question_id = p_question_id
    ) then
        raise exception 'QB_QUESTION_NOT_IN_ATTEMPT';
    end if;


    insert into public.responses (
        attempt_id,
        assignment_id,
        question_id,

        selected_answer,
        selected_value,

        response_seconds,
        answered_at,

        status
    )
    values (
        p_attempt_id,
        v_attempt.assignment_id,
        p_question_id,

        p_selected_answer,
        p_selected_value,

        greatest(coalesce(p_response_seconds,0),0),
        now(),

        'saved'
    )

    on conflict (
        attempt_id,
        question_id
    )
    do update
    set
        selected_answer =
            excluded.selected_answer,

        selected_value =
            excluded.selected_value,

        response_seconds =
            excluded.response_seconds,

        answered_at =
            now(),

        correct_answer =
            null,

        is_correct =
            null,

        marks_awarded =
            0,

        finalized_at =
            null,

        status =
            'saved';


    update public.attempts
    set
        answered_count = (
            select count(*)
            from public.responses r
            where r.attempt_id = p_attempt_id
              and (
                  nullif(
                      trim(
                          coalesce(
                              r.selected_answer,
                              ''
                          )
                      ),
                      ''
                  ) is not null
                  or r.selected_value is not null
              )
        ),

        last_activity_at =
            now()

    where id = p_attempt_id;


    return jsonb_build_object(
        'status','PASS',
        'attempt_id',p_attempt_id,
        'question_id',p_question_id,
        'saved_at',now()
    );

end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_save_practice_response(p_attempt_id uuid, p_question_id uuid, p_selected_answer text DEFAULT NULL::text, p_selected_value jsonb DEFAULT NULL::jsonb, p_response_seconds integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.attempts; q public.assessment_questions; r public.responses; correct boolean; explain text; question_hint text;
begin
 perform quizbox_private.enforce_budget('qb_save_practice_response',120,60);
 select * into t from public.attempts where id=p_attempt_id for update;
 if t.id is null or auth.uid() is null or t.student_user_id is distinct from auth.uid() then raise exception 'QB_ATTEMPT_OWNERSHIP_DENIED'; end if;
 if t.status<>'in_progress' or (t.expires_at is not null and t.expires_at<=now()) then raise exception 'QB_ATTEMPT_NOT_ACTIVE'; end if;
 if public.qb_attempt_mode(p_attempt_id) is distinct from 'PRACTICE' then raise exception 'QB_PRACTICE_ONLY'; end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.qb_complete_attempt(p_attempt_id uuid, p_submission_reason text DEFAULT 'student_submit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_attempt public.attempts; v_result jsonb; v_xp integer := 0;
begin
 perform quizbox_private.enforce_budget('qb_complete_attempt',30,60);
 if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED'; end if;
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.student_user_id is distinct from auth.uid() then raise exception 'ATTEMPT_ACCESS_DENIED'; end if;
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

  -- QB_SKIP_ZERO_XP: zero-point awards are no-ops under the existing table constraint.
   if coalesce(v_attempt.correct_count,0)>0 then insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'CORRECT_ANSWER',coalesce(v_attempt.correct_count,0)*5,'{}') on conflict(attempt_id,reason) do nothing; end if;
  insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'ASSIGNMENT_COMPLETION',20,'{}') on conflict(attempt_id,reason) do nothing;
  if coalesce(v_attempt.percentage,0)>=80 then insert into public.xp_transactions(student_user_id,attempt_id,reason,points,metadata) values(v_attempt.student_user_id,v_attempt.id,'HIGH_PROFICIENCY',25,'{}') on conflict(attempt_id,reason) do nothing; end if;
  select coalesce(sum(points),0) into v_xp from public.xp_transactions where attempt_id=v_attempt.id;
  return jsonb_build_object('attempt_id',v_attempt.id,'score',v_attempt.score,'total_marks',v_attempt.total_marks,'percentage',v_attempt.percentage,'correct',v_attempt.correct_count,'incorrect',v_attempt.incorrect_count,'unanswered',v_attempt.unanswered_count,'proficiency',public.qb_proficiency(v_attempt.percentage),'xp_earned',v_xp,'status',v_attempt.status);
end $function$
;
CREATE OR REPLACE FUNCTION public.qb_submit_attempt(p_attempt_id uuid, p_submission_reason text DEFAULT 'student_submit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_attempt public.attempts%rowtype;
    v_assessment public.assessments%rowtype;

    v_student_id uuid;

    v_result_id uuid;

    v_question_count integer := 0;
    v_answered_count integer := 0;
    v_correct_count integer := 0;
    v_incorrect_count integer := 0;
    v_unanswered_count integer := 0;

    v_score numeric := 0;
    v_total_marks numeric := 0;
    v_percentage numeric := 0;

    v_passed boolean := false;

    rec record;
    v_correct boolean;

begin
 perform quizbox_private.enforce_budget('qb_submit_attempt',30,60);
 if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED'; end if;

    v_student_id :=
        public.qb_current_student_id();


    select *
    into v_attempt
    from public.attempts
    where id = p_attempt_id
    for update;


    if not found then
        raise exception 'QB_ATTEMPT_NOT_FOUND';
    end if;


    if v_attempt.student_id is distinct from v_student_id
       and not public.qb_is_platform_admin()
    then
        raise exception 'QB_ATTEMPT_OWNERSHIP_DENIED';
    end if;


    if v_attempt.status::text in (
        'submitted',
        'auto_submitted',
        'completed'
    ) then

        select id
        into v_result_id
        from public.assessment_results
        where attempt_id = p_attempt_id;

        return jsonb_build_object(
            'status','PASS',
            'idempotent',true,
            'result_id',v_result_id
        );

    end if;


    if v_attempt.status <> 'in_progress' then
        raise exception 'QB_ATTEMPT_NOT_SUBMITTABLE';
    end if;


    select *
    into v_assessment
    from public.assessments
    where id = v_attempt.assessment_id;


    for rec in

        select
            aq.question_id,
            aq.answer_type_snapshot,
            aq.correct_answer_snapshot,
            aq.answer_spec_snapshot,
            coalesce(aq.marks_snapshot,1) as marks,

            r.id as response_id,
            r.selected_answer,
            r.selected_value

        from public.assessment_questions aq

        left join public.responses r
          on r.attempt_id = p_attempt_id
         and r.question_id = aq.question_id

        where aq.assessment_id =
            v_attempt.assessment_id

        order by aq.question_order

    loop

        v_question_count :=
            v_question_count + 1;

        v_total_marks :=
            v_total_marks +
            rec.marks;


        if rec.response_id is null
           or (
               nullif(
                   trim(
                       coalesce(
                           rec.selected_answer,
                           ''
                       )
                   ),
                   ''
               ) is null
               and rec.selected_value is null
           )
        then

            v_unanswered_count :=
                v_unanswered_count + 1;

            continue;

        end if;


        v_answered_count :=
            v_answered_count + 1;


        v_correct :=
            public.qb_grade_response(
                rec.answer_type_snapshot,
                rec.correct_answer_snapshot,
                rec.answer_spec_snapshot,
                rec.selected_answer,
                rec.selected_value
            );


        if v_correct then

            v_correct_count :=
                v_correct_count + 1;

            v_score :=
                v_score + rec.marks;

        else

            v_incorrect_count :=
                v_incorrect_count + 1;

        end if;


        update public.responses
        set
            correct_answer =
                rec.correct_answer_snapshot,

            is_correct =
                v_correct,

            marks_awarded =
                case
                    when v_correct
                    then rec.marks
                    else 0
                end,

            finalized_at =
                now(),

            status =
                'finalized'

        where id =
            rec.response_id;

    end loop;


    if v_total_marks > 0 then

        v_percentage :=
            round(
                (
                    v_score /
                    v_total_marks
                ) * 100,
                2
            );

    end if;


    v_passed :=
        v_percentage >=
        coalesce(
            v_attempt.pass_percent,
            v_assessment.pass_percent,
            50
        );


    insert into public.assessment_results (
        attempt_id,
        assessment_id,

        assignment_id,
        class_id,

        tenant_id,

        student_id,
        student_user_id,

        subject_code,
        grade,

        question_count,

        answered_count,
        correct_count,
        incorrect_count,
        unanswered_count,

        score,
        total_marks,

        percentage,

        pass_percent,
        passed,

        started_at,
        submitted_at,

        submission_reason,

        status
    )
    values (
        p_attempt_id,
        v_attempt.assessment_id,

        v_attempt.assignment_id,
        v_attempt.class_id,

        v_attempt.tenant_id,

        v_attempt.student_id,
        v_attempt.student_user_id,

        v_assessment.subject_code,
        v_assessment.grade::text,

        v_question_count,

        v_answered_count,
        v_correct_count,
        v_incorrect_count,
        v_unanswered_count,

        v_score,
        v_total_marks,

        v_percentage,

        coalesce(
            v_attempt.pass_percent,
            v_assessment.pass_percent,
            50
        ),

        v_passed,

        v_attempt.started_at,
        now(),

        p_submission_reason,

        'final'
    )

    on conflict(attempt_id)
    do update
    set
        answered_count =
            excluded.answered_count,

        correct_count =
            excluded.correct_count,

        incorrect_count =
            excluded.incorrect_count,

        unanswered_count =
            excluded.unanswered_count,

        score =
            excluded.score,

        total_marks =
            excluded.total_marks,

        percentage =
            excluded.percentage,

        passed =
            excluded.passed,

        submitted_at =
            excluded.submitted_at

    returning id
    into v_result_id;


    update public.attempts
    set
        submitted_at =
            now(),

        score =
            v_score,

        total_marks =
            v_total_marks,

        percentage =
            v_percentage,

        answered_count =
            v_answered_count,

        correct_count =
            v_correct_count,

        incorrect_count =
            v_incorrect_count,

        unanswered_count =
            v_unanswered_count,

        passed =
            v_passed,

        submission_reason =
            p_submission_reason,

        last_activity_at =
            now()

    where id = p_attempt_id;


    /*
     * Existing attempt_status enum values are preserved.
     * We use whatever submitted/completed label exists.
     */

    if exists (
        select 1
        from pg_enum e
        join pg_type t
          on t.oid = e.enumtypid
        where t.typname = 'attempt_status'
          and e.enumlabel = 'submitted'
    ) then

        update public.attempts
        set status = 'submitted'
        where id = p_attempt_id;

    elsif exists (
        select 1
        from pg_enum e
        join pg_type t
          on t.oid = e.enumtypid
        where t.typname = 'attempt_status'
          and e.enumlabel = 'completed'
    ) then

        update public.attempts
        set status = 'completed'
        where id = p_attempt_id;

    end if;


    -- Classroom gradebook write.

    if v_attempt.assignment_id is not null
       and v_attempt.class_id is not null
    then

        insert into public.gradebook (
            result_id,
            assessment_id,
            attempt_id,
            assignment_id,
            class_id,

            student_id,
            student_user_id,

            student_email,
            student_name,

            score,
            total_marks,
            percentage,

            status,
            graded_at
        )

        select
            v_result_id,
            v_attempt.assessment_id,
            v_attempt.id,
            v_attempt.assignment_id,
            v_attempt.class_id,

            sp.id,
            sp.user_id,

            p.email,
            p.full_name,

            v_score,
            v_total_marks,
            v_percentage,

            'final',
            now()

        from public.student_profiles sp
        join public.profiles p
          on p.id = sp.user_id

        where sp.id =
            v_attempt.student_id

        on conflict do nothing;

    end if;


    return jsonb_build_object(
        'status','PASS',

        'result_id',
            v_result_id,

        'attempt_id',
            p_attempt_id,

        'score',
            v_score,

        'total_marks',
            v_total_marks,

        'percentage',
            v_percentage,

        'correct_count',
            v_correct_count,

        'incorrect_count',
            v_incorrect_count,

        'unanswered_count',
            v_unanswered_count,

        'passed',
            v_passed
    );

end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_content_request_generation(p_spec jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.curriculum_nodes; batch uuid; hash text;
begin
 perform quizbox_private.enforce_budget('qb_content_request_generation',10,3600);
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;

 if jsonb_typeof(p_spec) is distinct from 'object' or jsonb_typeof(p_spec->'count') is distinct from 'number' or p_spec->>'count' !~ '^[0-9]+$'
 or coalesce(p_spec->>'difficulty','') not in ('easy','medium','hard') or coalesce(p_spec->>'answerType','') not in ('SINGLE_CHOICE','TRUE_FALSE')
 or nullif(trim(p_spec->>'cognitiveLevel'),'') is null or nullif(trim(p_spec->>'language'),'') is null or nullif(trim(p_spec->>'educationLevel'),'') is null
 or coalesce((p_spec->>'marks')::numeric,0) not between 0.01 and 100 or coalesce((p_spec->>'expectedSeconds')::integer,0) not between 5 and 3600
 then raise exception 'QB_INVALID_GENERATION_SPEC'; end if;
 select * into n from public.curriculum_nodes where id=(p_spec->>'indicatorId')::uuid and node_type in ('learning_indicator','learning_objective') and is_active;
 if n.id is null or p_spec->>'indicatorCode' is distinct from n.code or p_spec->>'curriculumId' is distinct from n.curriculum_id::text or coalesce((p_spec->>'count')::integer,0) not between 1 and 100 then raise exception 'QB_INVALID_GENERATION_SPEC'; end if;

 if n.subject_code is distinct from p_spec->>'subject' or coalesce(n.canonical_grade_code,n.grade_code) is distinct from p_spec->>'grade' or n.title is distinct from p_spec->>'indicatorTitle' then raise exception 'QB_INVALID_GENERATION_SPEC'; end if;
 perform pg_advisory_xact_lock(hashtext('qb_content_generation:'||auth.uid()::text));
 hash:=encode(extensions.digest('generation:'||p_spec::text,'sha256'),'hex');
 select id into batch from public.content_import_batches where source_hash=hash;
 if batch is not null then return jsonb_build_object('batch_id',batch,'replayed',true); end if;
 if (select count(*) from public.content_import_batches where imported_by=auth.uid() and started_at>now()-interval '1 minute')>=10 then raise exception 'QB_CONTENT_RATE_LIMIT'; end if;
 insert into public.content_import_batches(source_file,source_hash,imported_by,status,records_detected,generation_spec,source_type,provider,report) values('generation-request',hash,auth.uid(),'PREVIEW',(p_spec->>'count')::integer,p_spec,'AI_GENERATED','not-configured',jsonb_build_object('event','content.generation.requested','state','awaiting_provider','auto_approved',0)) returning id into batch;
 return jsonb_build_object('batch_id',batch,'state','awaiting_provider');
end $function$
;
CREATE OR REPLACE FUNCTION public.qb_content_ingest(p_spec jsonb, p_candidates jsonb, p_source_file text DEFAULT 'candidate.json'::text, p_provider text DEFAULT 'human'::text, p_model text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare batch public.content_import_batches; candidate jsonb; errors jsonb; n public.curriculum_nodes; inserted public.questions; digest text; idx integer:=0; valid integer:=0; rejected integer:=0; dup text; source text;
begin
 perform quizbox_private.enforce_budget('qb_content_ingest',20,3600);
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 if jsonb_typeof(p_spec) is distinct from 'object' or jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates) not between 1 and 100 or octet_length(p_candidates::text)>1000000 then raise exception 'QB_INVALID_BATCH'; end if;
 if length(coalesce(p_source_file,'')) not between 1 and 250 then raise exception 'QB_INVALID_BATCH'; end if;
 source:=coalesce(p_spec#>>'{provenance,source}','IMPORTED');
 if source not in ('AI_GENERATED','HUMAN_AUTHOR','IMPORTED','DEV_FACTORY_PILOT') then raise exception 'QB_INVALID_PROVENANCE'; end if;
 perform pg_advisory_xact_lock(hashtext('qb_content_ingest:'||auth.uid()::text));
 digest:=encode(extensions.digest(p_spec::text||p_candidates::text,'sha256'),'hex');
 select * into batch from public.content_import_batches where source_hash=digest;
 if found then return jsonb_build_object('batch_id',batch.id,'replayed',true); end if;
 if (select count(*) from public.content_import_batches where imported_by=auth.uid() and started_at>now()-interval '1 minute')>=10 then raise exception 'QB_CONTENT_RATE_LIMIT'; end if;
 insert into public.content_import_batches(source_file,source_hash,imported_by,status,records_detected,generation_spec,source_type,provider,model_version) values(p_source_file,digest,auth.uid(),'IMPORTING',jsonb_array_length(p_candidates),p_spec,source,p_provider,p_model) returning * into batch;
 for candidate in select value from jsonb_array_elements(p_candidates) loop
  idx:=idx+1; candidate:=candidate||jsonb_build_object('source_type',source); errors:=public.qb_content_validation_errors(candidate);
  if coalesce(candidate->>'external_question_id','')='' then errors:=errors||'"MISSING_EXTERNAL_ID"'::jsonb; end if;
  if exists(select 1 from public.questions where external_question_id=candidate->>'external_question_id') then errors:=errors||'"EXTERNAL_ID_COLLISION"'::jsonb; end if;
  dup:=null; select coalesce(duplicate_group_id,'dup-'||text_hash) into dup from public.questions where text_hash=encode(extensions.digest(public.qb_factory_normalize(candidate->>'question_text'),'sha256'),'hex') limit 1;
  if errors='[]'::jsonb then
   select * into n from public.curriculum_nodes where id=(candidate->>'curriculum_node_id')::uuid;
   insert into public.questions(external_question_id,question_code,curriculum_id,curriculum_node_id,subject_code,subject_name,grade,source_grade_code,canonical_grade_code,indicator_code,indicator_text,question_text,option_a,option_b,option_c,option_d,correct_answer,answer_type,answer_spec,question_content,explanation,hint,difficulty_label,difficulty_code,cognitive_level,marks,estimated_time_seconds,tags,source_type,source_version,curriculum_reference,validation_status,status,import_batch_id,duplicate_group_id,editorial_metadata)
   values(candidate->>'external_question_id',candidate->>'external_question_id',n.curriculum_id,n.id,n.subject_code,n.subject_code,coalesce(n.source_grade_code,n.grade_code)::public.qb_grade,n.source_grade_code,n.canonical_grade_code,n.code,n.title,candidate->>'question_text',coalesce(candidate->>'option_a',''),coalesce(candidate->>'option_b',''),coalesce(candidate->>'option_c',''),coalesce(candidate->>'option_d',''),candidate->>'correct_answer',candidate->>'answer_type',candidate->'answer_spec',candidate->'question_content',candidate->>'explanation',candidate->>'hint',candidate->>'difficulty_label',candidate->>'difficulty_label',candidate->>'cognitive_level',(candidate->>'marks')::numeric,(candidate->>'estimated_time_seconds')::integer,array(select jsonb_array_elements_text(coalesce(candidate->'tags','[]'::jsonb))),source,p_spec#>>'{provenance,sourceVersion}',n.code,'review','inactive',batch.id,dup,jsonb_build_object('structural_validated_at',now(),'human_reviewed',false,'provider',p_provider,'model',p_model,'warnings',jsonb_build_array('HUMAN_CHECK_DISTRACTORS_EXPLANATION_AND_ALIGNMENT'),'generated_state',case when source='AI_GENERATED' then 'generated' else 'draft' end)) returning * into inserted;
   valid:=valid+1;
   if dup is not null then update public.questions set duplicate_group_id=dup where text_hash=inserted.text_hash; end if;
  else rejected:=rejected+1; inserted.id:=null; end if;
  insert into public.question_import_staging(import_batch_id,row_number,external_source_id,normalized_payload,fingerprint,classification,issues,imported_question_id) values(batch.id,idx,candidate->>'external_question_id',candidate,encode(extensions.digest(public.qb_factory_normalize(candidate->>'question_text'),'sha256'),'hex'),case when errors<>'[]'::jsonb then 'rejected' when dup is not null then 'warning' else 'valid' end,errors,inserted.id);
 end loop;
 update public.content_import_batches set status='COMPLETED',completed_at=now(),valid_records=valid,rejected_records=rejected,inserted_records=valid,duplicates_skipped=(select count(*) from public.question_import_staging where import_batch_id=batch.id and classification='warning'),report=jsonb_build_object('event','content.batch.completed','review_count',valid,'auto_approved',0) where id=batch.id;
 return jsonb_build_object('batch_id',batch.id,'valid',valid,'rejected',rejected,'approved',0);
end $function$
;
CREATE OR REPLACE FUNCTION public.qb_content_review(p_id uuid, p_action text, p_version integer, p_expected_state text, p_patch jsonb DEFAULT '{}'::jsonb, p_note text DEFAULT ''::text, p_human_reviewed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.questions; errors jsonb; target text;
begin
 perform quizbox_private.enforce_budget('qb_content_review',120,60);
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_CONTENT_ACCESS_DENIED'; end if;
 if length(trim(p_note)) not between 3 and 1000 then raise exception 'QB_REVIEW_NOTE_REQUIRED'; end if;
 select * into q from public.questions where id=p_id for update;
 if q.id is null then raise exception 'QB_QUESTION_NOT_FOUND'; end if;
 if q.version is distinct from p_version or q.validation_status is distinct from p_expected_state then raise exception 'QB_CONTENT_CONFLICT'; end if;
 if p_action='edit' then
  if jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('question_text','option_a','option_b','option_c','option_d','correct_answer','answer_spec','explanation','hint','difficulty_label','cognitive_level','marks','estimated_time_seconds','question_content','curriculum_node_id')) then raise exception 'QB_INVALID_EDIT'; end if;
  errors:=public.qb_content_validation_errors(to_jsonb(q)||p_patch); if errors<>'[]'::jsonb then raise exception 'QB_CONTENT_VALIDATION_FAILED'; end if;
  update public.questions set question_text=coalesce(p_patch->>'question_text',q.question_text),option_a=coalesce(p_patch->>'option_a',q.option_a),option_b=coalesce(p_patch->>'option_b',q.option_b),option_c=coalesce(p_patch->>'option_c',q.option_c),option_d=coalesce(p_patch->>'option_d',q.option_d),correct_answer=coalesce(p_patch->>'correct_answer',q.correct_answer),answer_spec=coalesce(p_patch->'answer_spec',q.answer_spec),explanation=coalesce(p_patch->>'explanation',q.explanation),hint=coalesce(p_patch->>'hint',q.hint),difficulty_label=coalesce(p_patch->>'difficulty_label',q.difficulty_label),difficulty_code=coalesce(p_patch->>'difficulty_label',q.difficulty_code),cognitive_level=coalesce(p_patch->>'cognitive_level',q.cognitive_level),marks=coalesce((p_patch->>'marks')::numeric,q.marks),estimated_time_seconds=coalesce((p_patch->>'estimated_time_seconds')::integer,q.estimated_time_seconds),question_content=coalesce(p_patch->'question_content',q.question_content),curriculum_node_id=coalesce((p_patch->>'curriculum_node_id')::uuid,q.curriculum_node_id),editorial_metadata=q.editorial_metadata||jsonb_build_object('change_note',p_note) where id=q.id;
 elsif p_action='approve' then
  if q.validation_status<>'review' or p_human_reviewed is distinct from true then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if;
  errors:=public.qb_content_validation_errors(to_jsonb(q)); if errors<>'[]'::jsonb then raise exception 'QB_CONTENT_VALIDATION_FAILED'; end if;
  update public.questions set validation_status='approved',status='inactive',reviewed_by=auth.uid(),reviewed_at=now(),editorial_metadata=q.editorial_metadata||jsonb_build_object('human_reviewed',true,'review_note',p_note) where id=q.id;
 elsif p_action='publish' then
  if q.validation_status<>'approved' or q.reviewed_by is null or public.qb_content_validation_errors(to_jsonb(q))<>'[]'::jsonb then raise exception 'QB_CONTENT_NOT_APPROVED'; end if;
  update public.questions set status='active' where id=q.id;
 elsif p_action='archive' then update public.questions set status='archived' where id=q.id;
 elsif p_action in ('reject','revision','review') then
  target:=case p_action when 'reject' then 'rejected' when 'revision' then 'needs_revision' else 'review' end;
  update public.questions set validation_status=target,status='inactive',reviewed_by=null,reviewed_at=null,editorial_metadata=q.editorial_metadata||jsonb_build_object('review_note',p_note,'human_reviewed',false) where id=q.id;
 else raise exception 'QB_INVALID_REVIEW_ACTION'; end if;
 update public.content_import_batches set report=report||jsonb_build_object('last_event',jsonb_build_object('event','content.'||p_action,'question_id',q.id,'actor_id',auth.uid(),'at',now()),'events',coalesce(report->'events','[]'::jsonb)||jsonb_build_array(jsonb_build_object('event','content.'||p_action,'question_id',q.id,'actor_id',auth.uid(),'at',now()))) where id=q.import_batch_id;
 select * into q from public.questions where id=p_id;
 return jsonb_build_object('id',q.id,'version',q.version,'validation_status',q.validation_status,'status',q.status);
end $function$
;
CREATE OR REPLACE FUNCTION public.qb_admin_competition_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not (
        public.qb_has_permission('ANALYTICS_VIEW')
        or public.qb_has_permission('COMPETITION_MANAGE')
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    select jsonb_build_object(

        'competitions',
        (
            select count(*)
            from public.competitions
        ),

        'schools_registered',
        (
            select count(*)
            from public.competition_institutions
        ),

        'verified_schools',
        (
            select count(*)
            from public.competition_institutions
            where upper(verification_status) = 'VERIFIED'
        ),

        'teams',
        (
            select count(*)
            from public.competition_teams
        ),

        'team_members',
        (
            select count(*)
            from public.competition_team_members
        ),

        'stages',
        (
            select count(*)
            from public.competition_stages
        ),

        'rounds',
        (
            select count(*)
            from public.competition_rounds
        ),

        'matches',
        (
            select count(*)
            from public.competition_matches
        ),

        'results',
        (
            select count(*)
            from public.competition_results
        ),

        'appeals_open',
        (
            select count(*)
            from public.competition_appeals
            where upper(status) = 'OPEN'
        ),

        'sponsors',
        (
            select count(*)
            from public.competition_sponsors
        ),

        'committed_sponsorship',
        (
            select coalesce(sum(committed_amount),0)
            from public.competition_sponsors
            where upper(status) = 'ACTIVE'
        ),

        'generated_at',
        now()

    )
    into result;

    return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_admin_content_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not (
        public.qb_has_permission('ANALYTICS_VIEW')
        or public.qb_has_permission('CONTENT_MANAGE')
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    select jsonb_build_object(

        'total_questions',
        count(*),

        'active_questions',
        count(*) filter (
            where lower(coalesce(status::text,'')) = 'active'
        ),

        'missing_subject',
        count(*) filter (
            where subject_code is null
               or trim(subject_code) = ''
        ),

        'missing_grade',
        count(*) filter (
            where grade is null
        ),

        'missing_curriculum_indicator',
        count(*) filter (
            where indicator_code is null
               or trim(indicator_code) = ''
        ),

        'missing_explanation',
        count(*) filter (
            where explanation is null
               or trim(explanation) = ''
        ),

        'missing_external_id',
        count(*) filter (
            where external_question_id is null
               or trim(external_question_id) = ''
        ),

        'rich_content_questions',
        count(*) filter (
            where question_content is not null
        ),

        'image_or_media_questions',
        (
            select count(distinct qm.question_id)
            from public.question_media qm
        ),

        'question_banks',
        (
            select count(*)
            from public.question_banks
        ),

        'marketplace_eligible_banks',
        (
            select count(*)
            from public.question_banks qb
            where qb.marketplace_eligible = true
        ),

        'generated_at',
        now()

    )
    into result
    from public.questions;

    return result;

end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_admin_event_summary(p_days integer DEFAULT 30)
 RETURNS TABLE(event_name text, event_count bigint, unique_users bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not public.qb_has_permission('ANALYTICS_VIEW') then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    return query

    select
        ae.event_name,
        count(*)::bigint,
        count(distinct ae.user_id)::bigint
    from public.analytics_events ae
    where ae.occurred_at >=
        now() -
        make_interval(
            days => least(
                greatest(coalesce(p_days,30),1),
                365
            )
        )
    group by ae.event_name
    order by count(*) desc;

end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_admin_marketplace_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not (
        public.qb_has_permission('ANALYTICS_VIEW')
        or public.qb_has_permission('FINANCE_VIEW')
        or public.qb_has_permission('MARKETPLACE_MANAGE')
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    select jsonb_build_object(

        'sellers', jsonb_build_object(

            'total',
            (
                select count(*)
                from public.marketplace_sellers
            ),

            'verified',
            (
                select count(*)
                from public.marketplace_sellers
                where upper(verification_status) = 'VERIFIED'
            )
        ),

        'products', jsonb_build_object(

            'total',
            (
                select count(*)
                from public.marketplace_products
            ),

            'published',
            (
                select count(*)
                from public.marketplace_products
                where upper(status) = 'PUBLISHED'
            ),

            'approved',
            (
                select count(*)
                from public.marketplace_products
                where upper(moderation_status) = 'APPROVED'
            )
        ),

        'orders', jsonb_build_object(

            'total',
            (
                select count(*)
                from public.orders
            ),

            'paid',
            (
                select count(*)
                from public.orders
                where upper(payment_status) = 'PAID'
            ),

            'gross_paid_value',
            (
                select coalesce(sum(total_amount),0)
                from public.orders
                where upper(payment_status) = 'PAID'
            )
        ),

        'seller_economics', jsonb_build_object(

            'gross_earnings',
            (
                select coalesce(sum(gross_amount),0)
                from public.seller_earnings
            ),

            'platform_fees',
            (
                select coalesce(sum(platform_fee),0)
                from public.seller_earnings
            ),

            'seller_net',
            (
                select coalesce(sum(seller_net_amount),0)
                from public.seller_earnings
            ),

            'pending_payouts',
            (
                select coalesce(sum(amount),0)
                from public.payouts
                where upper(status) = 'PENDING'
            )
        ),

        'generated_at',
        now()

    )
    into result;

    return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_admin_operations_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not (
        public.qb_has_permission('ANALYTICS_VIEW')
        or public.qb_has_permission('SUPPORT_MANAGE')
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    select jsonb_build_object(

        'support', jsonb_build_object(

            'total_tickets',
            (
                select count(*)
                from public.support_tickets
            ),

            'open_tickets',
            (
                select count(*)
                from public.support_tickets
                where resolved_at is null
            ),

            'escalated_tickets',
            (
                select count(*)
                from public.support_tickets
                where escalation_level > 0
                  and resolved_at is null
            ),

            'sla_at_risk',
            (
                select count(*)
                from public.support_tickets
                where sla_due_at is not null
                  and sla_due_at < now()
                  and resolved_at is null
            )
        ),

        'notifications', jsonb_build_object(

            'total_deliveries',
            (
                select count(*)
                from public.notification_deliveries
            ),

            'failed',
            (
                select count(*)
                from public.notification_deliveries
                where upper(status) = 'FAILED'
            ),

            'pending',
            (
                select count(*)
                from public.notification_deliveries
                where upper(status) = 'PENDING'
            )
        ),

        'system_events', jsonb_build_object(

            'events_24h',
            (
                select count(*)
                from public.system_events
                where created_at >= now() - interval '24 hours'
            ),

            'errors_24h',
            (
                select count(*)
                from public.system_events
                where created_at >= now() - interval '24 hours'
                  and upper(severity) in (
                      'ERROR',
                      'CRITICAL'
                  )
            )
        ),

        'content_pipeline', jsonb_build_object(

            'pending_extraction_jobs',
            (
                select count(*)
                from public.content_extraction_jobs
                where upper(status) = 'PENDING'
            ),

            'pending_generation_jobs',
            (
                select count(*)
                from public.question_generation_jobs
                where upper(status) = 'PENDING'
            ),

            'failed_generation_jobs',
            (
                select count(*)
                from public.question_generation_jobs
                where upper(status) = 'FAILED'
            ),

            'pending_validation_runs',
            (
                select count(*)
                from public.validation_runs
                where upper(status) = 'PENDING'
            )
        ),

        'generated_at',
        now()

    )
    into result;

    return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_admin_platform_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not public.qb_has_permission('ANALYTICS_VIEW') then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    select jsonb_build_object(

        'users', jsonb_build_object(
            'total', (
                select count(*)
                from public.profiles
            ),

            'students', (
                select count(*)
                from public.student_profiles
            ),

            'teachers', (
                select count(*)
                from public.teacher_profiles
            ),

            'sponsors', (
                select count(*)
                from public.sponsor_profiles
            )
        ),

        'institutions', jsonb_build_object(
            'total', (
                select count(*)
                from public.institutions
            ),

            'classes', (
                select count(*)
                from public.classes
            ),

            'class_memberships', (
                select count(*)
                from public.class_memberships
            )
        ),

        'tenants', jsonb_build_object(
            'total', (
                select count(*)
                from public.tenants
            ),

            'active', (
                select count(*)
                from public.tenants
                where upper(status) = 'ACTIVE'
            )
        ),

        'content', jsonb_build_object(
            'questions', (
                select count(*)
                from public.questions
            ),

            'question_banks', (
                select count(*)
                from public.question_banks
            ),

            'sources', (
                select count(*)
                from public.question_sources
            ),

            'source_documents', (
                select count(*)
                from public.source_documents
            )
        ),

        'marketplace', jsonb_build_object(
            'sellers', (
                select count(*)
                from public.marketplace_sellers
            ),

            'products', (
                select count(*)
                from public.marketplace_products
            ),

            'orders', (
                select count(*)
                from public.orders
            )
        ),

        'competitions', jsonb_build_object(
            'competitions', (
                select count(*)
                from public.competitions
            ),

            'schools_registered', (
                select count(*)
                from public.competition_institutions
            ),

            'teams', (
                select count(*)
                from public.competition_teams
            )
        ),

        'support', jsonb_build_object(
            'tickets', (
                select count(*)
                from public.support_tickets
            )
        ),

        'generated_at', now()

    )
    into result;

    return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_admin_question_distribution()
 RETURNS TABLE(tenant_id uuid, subject_code text, grade text, question_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if auth.uid() is null or not public.qb_is_platform_admin() then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not public.qb_has_permission('ANALYTICS_VIEW') then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    return query

    select
        q.tenant_id,
        q.subject_code,
        q.grade::text,
        count(*)::bigint
    from public.questions q
    group by
        q.tenant_id,
        q.subject_code,
        q.grade
    order by
        q.subject_code,
        q.grade;

end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_get_daily_metrics(p_tenant_id uuid, p_from date DEFAULT (CURRENT_DATE - 30), p_to date DEFAULT CURRENT_DATE)
 RETURNS TABLE(metric_date date, metric_domain text, metric_name text, metric_value numeric, calculated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if auth.uid() is null or not (public.qb_is_platform_admin() or public.qb_can_manage_tenant(p_tenant_id)) then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not (
        public.qb_is_platform_admin()
        or public.qb_is_tenant_member(p_tenant_id)
        or public.qb_has_permission('ANALYTICS_VIEW')
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    return query

    select
        dm.metric_date,
        dm.metric_domain,
        dm.metric_name,
        dm.metric_value,
        dm.calculated_at
    from public.daily_metrics dm
    where dm.tenant_id = p_tenant_id
      and dm.metric_date between p_from and p_to
    order by
        dm.metric_date,
        dm.metric_domain,
        dm.metric_name;

end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_tenant_learning_metrics(p_tenant_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_from timestamptz;
begin
 if auth.uid() is null or not (public.qb_is_platform_admin() or public.qb_can_manage_tenant(p_tenant_id)) then raise exception 'QB_PERMISSION_DENIED'; end if;

    if not (
        public.qb_is_platform_admin()
        or public.qb_can_manage_tenant(p_tenant_id)
        or public.qb_has_permission('ANALYTICS_VIEW')
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    v_from :=
        now() -
        make_interval(
            days =>
                least(
                    greatest(
                        coalesce(p_days,30),
                        1
                    ),
                    365
                )
        );


    return jsonb_build_object(

        'attempts',
        (
            select count(*)
            from public.attempts a
            where a.tenant_id = p_tenant_id
              and a.started_at >= v_from
        ),

        'completed_attempts',
        (
            select count(*)
            from public.assessment_results ar
            where ar.tenant_id = p_tenant_id
              and ar.submitted_at >= v_from
        ),

        'unique_students',
        (
            select count(
                distinct ar.student_id
            )
            from public.assessment_results ar
            where ar.tenant_id = p_tenant_id
              and ar.submitted_at >= v_from
        ),

        'average_percentage',
        (
            select coalesce(
                round(avg(ar.percentage),2),
                0
            )
            from public.assessment_results ar
            where ar.tenant_id = p_tenant_id
              and ar.submitted_at >= v_from
        ),

        'pass_rate',
        (
            select
                case
                    when count(*) = 0
                        then 0

                    else round(
                        count(*) filter (
                            where ar.passed = true
                        )::numeric
                        /
                        count(*)::numeric
                        * 100,
                        2
                    )
                end

            from public.assessment_results ar

            where ar.tenant_id =
                p_tenant_id

              and ar.submitted_at >=
                v_from
        ),

        'generated_at',
            now()
    );

end;
$function$
;
CREATE OR REPLACE FUNCTION public.qb_controls_seller(p_seller_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    s public.marketplace_sellers%rowtype;
begin

    select *
    into s
    from public.marketplace_sellers
    where id = p_seller_id;

    if not found then
        return false;
    end if;

    if public.qb_is_platform_admin() then
        return true;
    end if;

    if upper(s.seller_type) = 'TEACHER' then
        return exists (
            select 1
            from public.teacher_profiles tp
            where tp.id = s.seller_entity_id
              and tp.user_id = auth.uid()
        );
    end if;

    if upper(s.seller_type) = 'INSTITUTION' then
        return public.qb_can_manage_institution(
            s.seller_entity_id
        );
    end if;

    if upper(s.seller_type) = 'TENANT' then
        return public.qb_can_manage_tenant(
            s.seller_entity_id
        );
    end if;

    if upper(s.seller_type) = 'USER' then
        return coalesce(s.seller_entity_id = auth.uid(),false);
    end if;

    return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION quizbox_private.join_class_core(p_join_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_class public.classes;
  v_student uuid;
  v_membership public.class_memberships;
begin

  select *
  into v_class
  from public.classes
  where upper(join_code) = upper(trim(p_join_code))
  limit 1;

  if v_class.id is null then
    raise exception 'INVALID_CLASS_CODE';
  end if;

  if v_class.status <> 'active'::public.qb_status then
    raise exception 'CLASS_NOT_ACTIVE';
  end if;

  if v_class.join_code_expires_at is not null
     and v_class.join_code_expires_at < now() then
    raise exception 'CLASS_CODE_EXPIRED';
  end if;

  v_student := public.qb_current_student_id();

  if v_student is null then
    raise exception 'STUDENT_PROFILE_REQUIRED';
  end if;

  insert into public.class_memberships(
    class_id,
    student_id,
    student_user_id,
    student_email,
    student_name,
    grade,
    status
  )
  select
    v_class.id,
    v_student,
    auth.uid(),
    p.email,
    p.full_name,
    v_class.grade,
    'active'::public.qb_status
  from public.profiles p
  where p.id = auth.uid()

  on conflict (class_id, student_id)
  do update
  set
    status = 'active'::public.qb_status,
    left_at = null

  returning * into v_membership;

  return jsonb_build_object(
    'membership_id', v_membership.id,
    'class_id', v_class.id,
    'class_name', v_class.class_name,
    'status', v_membership.status::text
  );

end
$function$
;
create or replace function public.qb_join_class(p_join_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare code text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if not quizbox_private.consume_budget('class_join',10,60) then
  return jsonb_build_object('error','QB_RATE_LIMITED');
 end if;
 begin
  if p_join_code is null or length(p_join_code)>64 then raise exception 'INVALID_CLASS_CODE'; end if;
  return quizbox_private.join_class_core(p_join_code);
 exception when others then
  code:=case when sqlerrm in ('INVALID_CLASS_CODE','CLASS_NOT_ACTIVE','CLASS_CODE_EXPIRED','STUDENT_PROFILE_REQUIRED') then sqlerrm else 'QB_OPERATION_FAILED' end;
  insert into public.audit_logs(actor_user_id,action,status,details) values(auth.uid(),'QB_OP_CLASS_JOIN','fail',jsonb_build_object('origin','database','error_code',code));
  return jsonb_build_object('error',code);
 end;
end $$;
revoke all on all functions in schema quizbox_private from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public;
