-- Read-only schema/function export, 2026-10-02. No hosted rows or credentials.
-- This fixture reuses the existing assessment engine; it is NOT a migration.
create type public.attempt_status as enum ('in_progress','submitted','expired');
create type public.qb_grade as enum ('B7','B8','B9','B4','B5','B6','B10','SHS1','SHS2','SHS3');
create type public.qb_role as enum ('student','teacher','admin','sponsor');
create type public.qb_status as enum ('active','inactive','archived');
create table public.assessment_questions (id uuid not null default gen_random_uuid(), assessment_id uuid not null, question_id uuid not null, question_order integer not null, question_text_snapshot text, option_a_snapshot text, option_b_snapshot text, option_c_snapshot text, option_d_snapshot text, correct_answer_snapshot text, marks_snapshot numeric(8,2), question_content_snapshot jsonb, answer_type_snapshot text, answer_spec_snapshot jsonb, options_snapshot jsonb, media_snapshot jsonb, source_type_snapshot text, question_version_snapshot integer, editorial_approved_snapshot boolean not null default false);
create table public.assessment_results (id uuid not null default gen_random_uuid(), attempt_id uuid not null, assessment_id uuid not null, assignment_id uuid, class_id uuid, tenant_id uuid, student_id uuid not null, student_user_id uuid not null, subject_code text, grade text, question_count integer not null default 0, answered_count integer not null default 0, correct_count integer not null default 0, incorrect_count integer not null default 0, unanswered_count integer not null default 0, score numeric(14,2) not null default 0, total_marks numeric(14,2) not null default 0, percentage numeric(8,2) not null default 0, pass_percent numeric(8,2), passed boolean, started_at timestamp with time zone, submitted_at timestamp with time zone, submission_reason text, status text not null default 'final'::text, created_at timestamp with time zone not null default now());
create table public.assessments (id uuid not null default gen_random_uuid(), assessment_type text not null default 'assignment'::text, owner_role qb_role not null, owner_user_id uuid not null, subject_code text not null, subject_name text not null, grade qb_grade not null, question_count integer not null, difficulty text not null default 'mixed'::text, strand_no text, substrand_no text, time_limit_minutes integer not null default 20, max_attempts integer not null default 1, allow_resume boolean not null default true, auto_submit boolean not null default true, pass_percent numeric(5,2) not null default 50, expires_at timestamp with time zone, created_at timestamp with time zone not null default now(), tenant_id uuid, opens_at timestamp with time zone, instructions text, reference_type text, reference_id uuid);
create table public.attempts (id uuid not null default gen_random_uuid(), assignment_id uuid, assessment_id uuid not null, class_id uuid, student_id uuid not null, student_user_id uuid not null, started_at timestamp with time zone not null default now(), submitted_at timestamp with time zone, expires_at timestamp with time zone, score numeric(8,2), total_marks numeric(8,2), percentage numeric(5,2), status attempt_status not null default 'in_progress'::attempt_status, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now(), tenant_id uuid, deadline_at timestamp with time zone, last_activity_at timestamp with time zone, answered_count integer not null default 0, correct_count integer, incorrect_count integer, unanswered_count integer, pass_percent numeric(8,2), passed boolean, submission_reason text, client_session_id text);
create table public.question_versions (id uuid not null default gen_random_uuid(), question_id uuid not null, version_no integer not null, snapshot jsonb not null, change_reason text, created_by uuid, created_at timestamp with time zone not null default now());
create table public.questions (id uuid not null default gen_random_uuid(), source_id uuid, external_question_id text, subject_code text not null, subject_name text not null, grade qb_grade not null, strand_no text, strand_name text, substrand_no text, substrand_name text, difficulty_code text, question_text text not null, option_a text not null, option_b text not null, option_c text not null, option_d text not null, correct_answer text not null, explanation text, status qb_status not null default 'active'::qb_status, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now(), level_code text, question_code text, batch_id text, learning_area_code text, learning_area_name text, content_standard_code text, content_standard_text text, indicator_code text, indicator_text text, difficulty_label text, cognitive_level text, marks numeric(8,2) not null default 1, estimated_time_seconds integer, tags text[] not null default ARRAY[]::text[], source_type text, curriculum_reference text, validation_status text default 'review'::text, duplicate_group_id text, commercial_status text, imported_at timestamp with time zone, source_storage_path text, question_content jsonb, answer_type text not null default 'SINGLE_CHOICE'::text, answer_spec jsonb, rendering_version integer not null default 1, tenant_id uuid, curriculum_id uuid, curriculum_node_id uuid, import_batch_id uuid, source_version text, version integer not null default 1, hint text, source_grade_code text, canonical_grade_code text, editorial_metadata jsonb not null default '{}'::jsonb, text_hash text, answer_hash text, option_signature text, reviewed_by uuid, reviewed_at timestamp with time zone);
create table public.responses (id uuid not null default gen_random_uuid(), attempt_id uuid not null, assignment_id uuid, question_id uuid not null, selected_answer text, correct_answer text, is_correct boolean, marks_awarded numeric(8,2) not null default 0, response_seconds integer not null default 0, answered_at timestamp with time zone not null default now(), selected_value jsonb, finalized_at timestamp with time zone, status text not null default 'saved'::text);
create table public.student_profiles (id uuid not null default gen_random_uuid(), user_id uuid not null, grade qb_grade not null, school_name text, region text, country text not null default 'Ghana'::text, status qb_status not null default 'active'::qb_status, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now(), institution_id uuid);
alter table public.assessment_questions add constraint assessment_questions_answer_type_snapshot_check CHECK (((answer_type_snapshot IS NULL) OR (answer_type_snapshot = ANY (ARRAY['SINGLE_CHOICE'::text, 'MULTIPLE_CHOICE'::text, 'NUMERIC'::text, 'FRACTION'::text, 'EXPRESSION'::text, 'SHORT_TEXT'::text, 'TRUE_FALSE'::text]))));
alter table public.assessment_questions add constraint assessment_questions_assessment_id_question_id_key UNIQUE (assessment_id, question_id);
alter table public.assessment_questions add constraint assessment_questions_assessment_id_question_order_key UNIQUE (assessment_id, question_order);
alter table public.assessment_questions add constraint assessment_questions_pkey PRIMARY KEY (id);
alter table public.assessment_questions add constraint assessment_questions_question_order_check CHECK ((question_order > 0));
alter table public.assessment_questions add constraint assessment_questions_snapshot_answer_check CHECK (((correct_answer_snapshot IS NULL) OR (correct_answer_snapshot = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text]))));
alter table public.assessment_results add constraint assessment_results_attempt_id_key UNIQUE (attempt_id);
alter table public.assessment_results add constraint assessment_results_pkey PRIMARY KEY (id);
alter table public.assessments add constraint assessments_pkey PRIMARY KEY (id);
alter table public.assessments add constraint assessments_question_count_check CHECK ((question_count > 0));
alter table public.attempts add constraint attempts_pkey PRIMARY KEY (id);
alter table public.question_versions add constraint question_versions_pkey PRIMARY KEY (id);
alter table public.question_versions add constraint question_versions_question_id_version_no_key UNIQUE (question_id, version_no);
alter table public.questions add constraint questions_answer_spec_object_check CHECK (((answer_spec IS NULL) OR (jsonb_typeof(answer_spec) = 'object'::text)));
alter table public.questions add constraint questions_answer_type_check CHECK ((answer_type = ANY (ARRAY['SINGLE_CHOICE'::text, 'MULTIPLE_CHOICE'::text, 'NUMERIC'::text, 'FRACTION'::text, 'EXPRESSION'::text, 'SHORT_TEXT'::text, 'TRUE_FALSE'::text])));
alter table public.questions add constraint questions_correct_answer_check CHECK ((correct_answer = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])));
alter table public.questions add constraint questions_editorial_state_check CHECK (((validation_status IS NOT NULL) AND (validation_status = ANY (ARRAY['draft'::text, 'generated'::text, 'review'::text, 'approved'::text, 'rejected'::text, 'needs_revision'::text]))));
alter table public.questions add constraint questions_external_question_id_unique UNIQUE (external_question_id);
alter table public.questions add constraint questions_pkey PRIMARY KEY (id);
alter table public.questions add constraint questions_question_content_object_check CHECK (((question_content IS NULL) OR (jsonb_typeof(question_content) = 'object'::text)));
alter table public.responses add constraint responses_attempt_id_question_id_key UNIQUE (attempt_id, question_id);
alter table public.responses add constraint responses_correct_answer_check CHECK ((correct_answer = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])));
alter table public.responses add constraint responses_pkey PRIMARY KEY (id);
alter table public.responses add constraint responses_selected_answer_check CHECK ((selected_answer = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])));
alter table public.student_profiles add constraint student_profiles_pkey PRIMARY KEY (id);
alter table public.student_profiles add constraint student_profiles_user_id_key UNIQUE (user_id);
create schema quizbox_private;
-- Infrastructure budget is mocked ONLY in this isolated fixture.
create function quizbox_private.consume_budget(text,integer,integer) returns boolean language sql as $$ select auth.uid() is not null $$;
CREATE OR REPLACE FUNCTION public.qb_normalize_text(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select upper(
        regexp_replace(
            trim(coalesce(p_value,'')),
            '\s+',
            ' ',
            'g'
        )
    );
$function$

CREATE OR REPLACE FUNCTION public.qb_current_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce((select upper(role::text) from public.profiles where id=auth.uid() and status='active'),'');
$function$

CREATE OR REPLACE FUNCTION public.qb_current_student_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select sp.id
    from public.student_profiles sp
    where sp.user_id = auth.uid()
    limit 1;
$function$

CREATE OR REPLACE FUNCTION public.qb_is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select public.qb_current_role() in ('OWNER','ADMIN');
$function$

CREATE OR REPLACE FUNCTION public.qb_grade_response(p_answer_type text, p_correct_answer text, p_answer_spec jsonb, p_selected_answer text, p_selected_value jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_type text :=
        upper(coalesce(p_answer_type,'SINGLE_CHOICE'));

    v_expected numeric;
    v_actual numeric;
    v_tolerance numeric := 0;

    v_n1 numeric;
    v_d1 numeric;
    v_n2 numeric;
    v_d2 numeric;

    v_correct_options text[];
    v_selected_options text[];

begin

    if v_type in ('SINGLE_CHOICE','TRUE_FALSE') then

        return
            public.qb_normalize_text(p_selected_answer)
            =
            public.qb_normalize_text(p_correct_answer);

    end if;


    if v_type = 'MULTIPLE_CHOICE' then

        select array_agg(upper(x) order by upper(x))
        into v_correct_options
        from jsonb_array_elements_text(
            coalesce(
                p_answer_spec -> 'correct_options',
                '[]'::jsonb
            )
        ) x;


        select array_agg(upper(x) order by upper(x))
        into v_selected_options
        from jsonb_array_elements_text(
            coalesce(
                p_selected_value -> 'options',
                '[]'::jsonb
            )
        ) x;


        return
            coalesce(v_correct_options, array[]::text[])
            =
            coalesce(v_selected_options, array[]::text[]);

    end if;


    if v_type = 'NUMERIC' then

        begin
            v_expected :=
                (p_answer_spec ->> 'value')::numeric;

            v_tolerance :=
                coalesce(
                    (p_answer_spec ->> 'tolerance')::numeric,
                    0
                );

            v_actual :=
                coalesce(
                    (p_selected_value ->> 'value')::numeric,
                    p_selected_answer::numeric
                );

        exception
            when others then
                return false;
        end;

        return abs(v_actual - v_expected) <= v_tolerance;

    end if;


    if v_type = 'FRACTION' then

        begin
            v_n1 := (p_answer_spec ->> 'numerator')::numeric;
            v_d1 := (p_answer_spec ->> 'denominator')::numeric;

            v_n2 := (p_selected_value ->> 'numerator')::numeric;
            v_d2 := (p_selected_value ->> 'denominator')::numeric;

        exception
            when others then
                return false;
        end;

        if v_d1 = 0 or v_d2 = 0 then
            return false;
        end if;

        return (v_n1 * v_d2) = (v_n2 * v_d1);

    end if;


    if v_type = 'SHORT_TEXT' then

        if p_answer_spec ? 'accepted' then

            return exists (
                select 1
                from jsonb_array_elements_text(
                    p_answer_spec -> 'accepted'
                ) x
                where public.qb_normalize_text(x)
                    =
                    public.qb_normalize_text(p_selected_answer)
            );

        end if;

        return
            public.qb_normalize_text(p_selected_answer)
            =
            public.qb_normalize_text(
                p_answer_spec ->> 'value'
            );

    end if;


    if v_type = 'EXPRESSION' then

        if p_answer_spec ? 'accepted' then

            return exists (
                select 1
                from jsonb_array_elements_text(
                    p_answer_spec -> 'accepted'
                ) x
                where replace(
                    public.qb_normalize_text(x),
                    ' ',
                    ''
                )
                =
                replace(
                    public.qb_normalize_text(p_selected_answer),
                    ' ',
                    ''
                )
            );

        end if;

        return
            replace(
                public.qb_normalize_text(p_selected_answer),
                ' ',
                ''
            )
            =
            replace(
                public.qb_normalize_text(
                    p_answer_spec ->> 'canonical'
                ),
                ' ',
                ''
            );

    end if;


    return false;

end;
$function$

CREATE OR REPLACE FUNCTION public.qb_is_acceptance_actor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
 and lower(email) in ('student.test@quizbox.local','student2.test@quizbox.local','teacher.test@quizbox.local','admin.test@quizbox.local','sponsor.test@quizbox.local','seller.test@quizbox.local'));
$function$

CREATE OR REPLACE FUNCTION public.qb_public_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select id
    from public.tenants
    where code = 'QUIZBOX_PUBLIC'
    limit 1;
$function$

CREATE OR REPLACE FUNCTION public.qb_is_tenant_member(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from public.tenant_memberships tm
        where tm.tenant_id = p_tenant_id
          and tm.user_id = auth.uid()
          and upper(tm.status) = 'ACTIVE'
    );
$function$

CREATE OR REPLACE FUNCTION public.qb_can_access_learning_assessment(p_assessment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select auth.uid() is not null and exists (
 select 1 from public.assessments a where a.id=p_assessment_id
 and not exists(select 1 from public.assessment_questions aq join public.questions q on q.id=aq.question_id where aq.assessment_id=a.id and q.source_type in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT') and not public.qb_is_acceptance_actor())

 and not exists(select 1 from public.assessment_questions aq where aq.assessment_id=a.id
 and (not aq.editorial_approved_snapshot and not (coalesce(aq.source_type_snapshot,'') in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT') and public.qb_is_acceptance_actor())
 or coalesce(aq.source_type_snapshot,'') in ('DEV_ACCEPTANCE_FIXTURE','DEV_FACTORY_PILOT') and not public.qb_is_acceptance_actor()))
 and (a.tenant_id=public.qb_public_tenant_id() or public.qb_is_tenant_member(a.tenant_id) or public.qb_is_platform_admin())
 and (
 public.qb_is_platform_admin() or a.owner_user_id=auth.uid()
 or (not exists(select 1 from public.assignments x where x.assessment_id=a.id) and coalesce(a.reference_type,'')<>'ASSIGNMENT')
 or exists(select 1 from public.assignments x join public.class_memberships m on m.class_id=x.class_id
 where x.assessment_id=a.id and x.status='published' and m.student_user_id=auth.uid() and m.status='active'
 and (x.recipient_mode='class' or exists(select 1 from public.assignment_targets t where t.assignment_id=x.id and t.membership_id=m.id and t.status='active')))
 ));
$function$

CREATE OR REPLACE FUNCTION quizbox_private.core_qb_start_attempt(p_assessment_id uuid, p_assignment_id uuid, p_class_id uuid, p_client_session_id text DEFAULT NULL::text)
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

CREATE OR REPLACE FUNCTION quizbox_private.core_qb_save_response(p_attempt_id uuid, p_question_id uuid, p_selected_answer text DEFAULT NULL::text, p_selected_value jsonb DEFAULT NULL::jsonb, p_response_seconds integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_attempt public.attempts%rowtype;
    v_student_id uuid;

begin
 
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

CREATE OR REPLACE FUNCTION quizbox_private.core_qb_submit_attempt(p_attempt_id uuid, p_submission_reason text DEFAULT 'student_submit'::text)
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

CREATE OR REPLACE FUNCTION public.qb_start_attempt(p_assessment_id uuid, p_assignment_id uuid, p_class_id uuid, p_client_session_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
   declare failure text;
   begin
    if not quizbox_private.consume_budget('qb_start_attempt',10,60) then
     perform set_config('response.status','429',true);
     return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
    end if;
    begin
     return quizbox_private.core_qb_start_attempt(p_assessment_id,p_assignment_id,p_class_id,p_client_session_id);
    exception when others then
     failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
     perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
     return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
    end;
   end $function$

CREATE OR REPLACE FUNCTION public.qb_save_response(p_attempt_id uuid, p_question_id uuid, p_selected_answer text DEFAULT NULL::text, p_selected_value jsonb DEFAULT NULL::jsonb, p_response_seconds integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
   declare failure text;
   begin
    if not quizbox_private.consume_budget('qb_save_response',180,60) then
     perform set_config('response.status','429',true);
     return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
    end if;
    begin
     return quizbox_private.core_qb_save_response(p_attempt_id,p_question_id,p_selected_answer,p_selected_value,p_response_seconds);
    exception when others then
     failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
     perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
     return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
    end;
   end $function$

CREATE OR REPLACE FUNCTION public.qb_submit_attempt(p_attempt_id uuid, p_submission_reason text DEFAULT 'student_submit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
   declare failure text;
   begin
    if not quizbox_private.consume_budget('qb_submit_attempt',30,60) then
     perform set_config('response.status','429',true);
     return jsonb_build_object('code','P0001','message','QB_RATE_LIMITED','details',null,'hint',null);
    end if;
    begin
     return quizbox_private.core_qb_submit_attempt(p_attempt_id,p_submission_reason);
    exception when others then
     failure:=case when SQLERRM ~ '^[A-Z][A-Z_0-9]{1,80}$' then SQLERRM else 'OPERATION_FAILED' end;
     perform set_config('response.status',case when SQLSTATE='42501' then '403' else '400' end,true);
     return jsonb_build_object('code',SQLSTATE,'message',failure,'details',null,'hint',null);
    end;
   end $function$

CREATE OR REPLACE FUNCTION public.qb_get_attempt(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_attempt public.attempts%rowtype;
    v_student_id uuid;

    v_questions jsonb;
    v_responses jsonb;

begin
 if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED'; end if;

    v_student_id :=
        public.qb_current_student_id();


    select *
    into v_attempt
    from public.attempts
    where id = p_attempt_id;


    if not found then
        raise exception 'QB_ATTEMPT_NOT_FOUND';
    end if;


    if v_attempt.student_id is distinct from v_student_id
       and not public.qb_is_platform_admin()
    then
        raise exception 'QB_ATTEMPT_OWNERSHIP_DENIED';
    end if;


    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'question_order',aq.question_order,
                'question_id',aq.question_id,
                'question_text',aq.question_text_snapshot,
                'question_content',aq.question_content_snapshot,
                'answer_type',aq.answer_type_snapshot,
                'option_a',aq.option_a_snapshot,
                'option_b',aq.option_b_snapshot,
                'option_c',aq.option_c_snapshot,
                'option_d',aq.option_d_snapshot,
                'options',aq.options_snapshot,
                'media',aq.media_snapshot,
                'marks',aq.marks_snapshot
            )
            order by aq.question_order
        ),
        '[]'::jsonb
    )
    into v_questions
    from public.assessment_questions aq
    where aq.assessment_id = v_attempt.assessment_id;


    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'question_id',r.question_id,
                'selected_answer',r.selected_answer,
                'selected_value',r.selected_value,
                'answered_at',r.answered_at
            )
        ),
        '[]'::jsonb
    )
    into v_responses
    from public.responses r
    where r.attempt_id = p_attempt_id;


    return jsonb_build_object(
        'status','PASS',

        'attempt_id',v_attempt.id,
        'assessment_id',v_attempt.assessment_id,

        'attempt_status',v_attempt.status::text,

        'started_at',v_attempt.started_at,
        'expires_at',v_attempt.expires_at,

        'server_time',now(),

        'remaining_seconds',
            greatest(
                ceil(
                    extract(
                        epoch from
                        (v_attempt.expires_at - now())
                    )
                )::integer,
                0
            ),

        'questions',v_questions,
        'saved_responses',v_responses
    );

end;
$function$

CREATE OR REPLACE FUNCTION public.qb_get_result(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    r public.assessment_results%rowtype;
    v_student_id uuid;

begin
 if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED'; end if;

    v_student_id :=
        public.qb_current_student_id();


    select *
    into r
    from public.assessment_results
    where attempt_id = p_attempt_id;


    if not found then
        raise exception 'QB_RESULT_NOT_FOUND';
    end if;


    if r.student_id is distinct from v_student_id
       and not public.qb_is_platform_admin()
    then
        raise exception 'QB_RESULT_OWNERSHIP_DENIED';
    end if;


    return to_jsonb(r);

end;
$function$


