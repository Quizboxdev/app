-- Production-only objects exported from the hosted database (query 24), cleaned: 129 objects. Reference only: not a migration.

-- FUNCTION public.qb_add_team_member
CREATE OR REPLACE FUNCTION public.qb_add_team_member(p_team_id uuid, p_student_id uuid, p_role text DEFAULT 'MEMBER'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_team public.competition_teams%rowtype;
    v_member_id uuid;
begin if not quizbox_market.team_allowed(p_team_id) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;

    select *
    into v_team
    from public.competition_teams
    where id = p_team_id;


    if not found then
        raise exception 'QB_COMPETITION_TEAM_NOT_FOUND';
    end if;


    if not (
        public.qb_can_manage_institution(
            v_team.institution_id
        )
        or public.qb_has_permission(
            'COMPETITION_MANAGE'
        )
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    if not exists (
        select 1
        from public.student_profiles
        where id = p_student_id
    ) then
        raise exception 'QB_STUDENT_NOT_FOUND';
    end if;


    insert into public.competition_team_members(
        team_id,
        student_id,
        role,
        roster_status
    )
    values(
        p_team_id,
        p_student_id,
        upper(coalesce(p_role,'MEMBER')),
        'PENDING'
    )

    on conflict(
        team_id,
        student_id
    )
    do update
    set
        role =
            excluded.role

    returning id
    into v_member_id;


    return jsonb_build_object(
        'status','PASS',
        'team_member_id',v_member_id,
        'roster_status','PENDING'
    );

end;
$function$
;

-- FUNCTION public.qb_attach_competition_sponsor
CREATE OR REPLACE FUNCTION public.qb_attach_competition_sponsor(p_competition_id uuid, p_sponsor_id uuid, p_sponsorship_role text DEFAULT 'SPONSOR'::text, p_committed_amount numeric DEFAULT NULL::numeric, p_currency text DEFAULT 'GHS'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_id uuid;
begin if not quizbox_market.competition_allowed(p_competition_id) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;

    if not (
        public.qb_has_permission(
            'COMPETITION_MANAGE'
        )
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    insert into public.competition_sponsors(
        competition_id,
        sponsor_id,
        sponsorship_role,
        committed_amount,
        currency,
        status
    )
    values(
        p_competition_id,
        p_sponsor_id,
        upper(
            coalesce(
                p_sponsorship_role,
                'SPONSOR'
            )
        ),
        p_committed_amount,
        upper(coalesce(p_currency,'GHS')),
        'ACTIVE'
    )

    on conflict(
        competition_id,
        sponsor_id,
        sponsorship_role
    )
    do update
    set
        committed_amount =
            excluded.committed_amount,

        currency =
            excluded.currency,

        status =
            'ACTIVE'

    returning id
    into v_id;


    return jsonb_build_object(
        'status','PASS',
        'competition_sponsor_id',v_id
    );

end;
$function$
;

-- FUNCTION public.qb_backend_acceptance
CREATE OR REPLACE FUNCTION public.qb_backend_acceptance()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_missing_tables text[];
    v_missing_functions text[];
    v_rls_failures text[];
begin

    -- --------------------------------------------------------
    -- REQUIRED TABLES
    -- --------------------------------------------------------

    select array_agg(required_name)
    into v_missing_tables

    from (
        select unnest(
            array[
                'profiles',
                'student_profiles',
                'teacher_profiles',
                'sponsor_profiles',

                'tenants',
                'tenant_memberships',

                'questions',
                'question_options',
                'question_media',

                'question_banks',
                'question_bank_items',

                'assessments',
                'assessment_questions',
                'attempts',
                'responses',
                'assessment_results',
                'gradebook',

                'classes',
                'class_memberships',
                'assignments',

                'marketplace_sellers',
                'marketplace_products',
                'orders',
                'order_items',
                'seller_earnings',
                'payouts',
                'entitlements',

                'competitions',
                'competition_institutions',
                'competition_teams',
                'competition_team_members',
                'competition_results',
                'competition_sponsors',

                'analytics_events',
                'daily_metrics',

                'support_tickets',
                'audit_logs',
                'system_events'
            ]
        ) as required_name
    ) required

    where not exists (
        select 1
        from information_schema.tables t
        where t.table_schema = 'public'
          and t.table_name =
                required.required_name
    );


    -- --------------------------------------------------------
    -- REQUIRED RPCs
    -- --------------------------------------------------------

    select array_agg(required_name)
    into v_missing_functions

    from (
        select unnest(
            array[
                'qb_get_questions',
                'qb_start_attempt',
                'qb_get_attempt',
                'qb_save_response',
                'qb_submit_attempt',
                'qb_get_result',
                'qb_get_attempt_review',

                'qb_admin_platform_overview',
                'qb_tenant_dashboard',
                'qb_tenant_learning_metrics',

                'qb_create_marketplace_order',
                'qb_settle_paid_order',
                'qb_seller_balance',
                'qb_request_payout',

                'qb_register_competition_school',
                'qb_create_competition_team',
                'qb_add_team_member',
                'qb_record_competition_result',
                'qb_finalize_competition_leaderboard',
                'qb_competition_leaderboard'
            ]
        ) as required_name
    ) required

    where not exists (
        select 1
        from information_schema.routines r
        where r.routine_schema = 'public'
          and r.routine_name =
                required.required_name
    );


    -- --------------------------------------------------------
    -- CRITICAL RLS CHECK
    -- --------------------------------------------------------

    select array_agg(required_name)
    into v_rls_failures

    from (
        select unnest(
            array[
                'questions',
                'assessment_questions',
                'attempts',
                'responses',
                'assessment_results',

                'tenants',
                'tenant_memberships',

                'marketplace_products',
                'orders',

                'competition_teams',
                'competition_results',

                'analytics_events'
            ]
        ) as required_name
    ) required

    where not exists (
        select 1
        from pg_tables p
        where p.schemaname = 'public'
          and p.tablename =
                required.required_name
          and p.rowsecurity = true
    );


    return jsonb_build_object(

        'status',
            case
                when
                    coalesce(
                        array_length(
                            v_missing_tables,
                            1
                        ),
                        0
                    ) = 0

                    and

                    coalesce(
                        array_length(
                            v_missing_functions,
                            1
                        ),
                        0
                    ) = 0

                    and

                    coalesce(
                        array_length(
                            v_rls_failures,
                            1
                        ),
                        0
                    ) = 0

                then 'PASS'

                else 'FAIL'
            end,

        'release',
            'QB-BACKEND-FINAL-1',

        'missing_tables',
            coalesce(
                to_jsonb(v_missing_tables),
                '[]'::jsonb
            ),

        'missing_functions',
            coalesce(
                to_jsonb(v_missing_functions),
                '[]'::jsonb
            ),

        'rls_failures',
            coalesce(
                to_jsonb(v_rls_failures),
                '[]'::jsonb
            ),

        'checked_at',
            now()
    );

end;
$function$
;

-- FUNCTION public.qb_can_manage_class
CREATE OR REPLACE FUNCTION public.qb_can_manage_class(p_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$select quizbox_market.class_allowed(p_class_id) and coalesce((
    select
        public.qb_is_platform_admin()
        or exists (
            select 1
            from public.classes c
            where c.id = p_class_id
              and (
                    c.primary_teacher_id = public.qb_current_teacher_id()
                    or (
                        c.tenant_id is not null
                        and public.qb_can_manage_tenant(c.tenant_id)
                    )
                  )
        )),false);$function$
;

-- FUNCTION public.qb_can_manage_institution
CREATE OR REPLACE FUNCTION public.qb_can_manage_institution(p_institution_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        public.qb_is_platform_admin()
        or exists (
            select 1
            from public.institution_memberships im
            where im.institution_id = p_institution_id
              and im.user_id = auth.uid()
              and upper(im.status::text) = 'ACTIVE'
              and upper(im.role::text) in (
                  'OWNER',
                  'ADMIN',
                  'ADMINISTRATOR',
                  'HEAD_TEACHER',
                  'HEADTEACHER'
              )
        );
$function$
;

-- FUNCTION public.qb_can_manage_tenant
CREATE OR REPLACE FUNCTION public.qb_can_manage_tenant(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        public.qb_is_platform_admin()
        or public.qb_tenant_role(p_tenant_id)
           in (
               'OWNER',
               'ADMIN',
               'TENANT_ADMIN',
               'INSTITUTION_ADMIN'
           );
$function$
;

-- FUNCTION public.qb_consume_budget
CREATE OR REPLACE FUNCTION public.qb_consume_budget(p_key text, p_limit integer, p_seconds integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select quizbox_private.consume_intake_budget(left(p_key, 120), p_limit, p_seconds) $function$
;

-- FUNCTION public.qb_create_competition_team
CREATE OR REPLACE FUNCTION public.qb_create_competition_team(p_competition_id uuid, p_institution_id uuid, p_team_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_team_id uuid;
    v_team_code text;
begin if not quizbox_market.competition_allowed(p_competition_id) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;

    if not (
        public.qb_can_manage_institution(
            p_institution_id
        )
        or public.qb_has_permission(
            'COMPETITION_MANAGE'
        )
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    if nullif(trim(p_team_name),'') is null then
        raise exception 'QB_TEAM_NAME_REQUIRED';
    end if;


    if not exists (
        select 1
        from public.competition_institutions ci
        where ci.competition_id =
                p_competition_id
          and ci.institution_id =
                p_institution_id
    ) then
        raise exception
            'QB_SCHOOL_NOT_REGISTERED_FOR_COMPETITION';
    end if;


    v_team_code :=
        'TEAM-' ||
        upper(
            substr(
                replace(
                    gen_random_uuid()::text,
                    '-',
                    ''
                ),
                1,
                8
            )
        );


    insert into public.competition_teams(
        competition_id,
        institution_id,
        team_name,
        team_code,
        status
    )
    values(
        p_competition_id,
        p_institution_id,
        trim(p_team_name),
        v_team_code,
        'ACTIVE'
    )

    on conflict(
        competition_id,
        team_name
    )
    do update
    set
        institution_id =
            excluded.institution_id

    returning id
    into v_team_id;


    return jsonb_build_object(
        'status','PASS',
        'team_id',v_team_id,
        'team_code',v_team_code,
        'team_name',trim(p_team_name)
    );

end;
$function$
;

-- FUNCTION public.qb_create_marketplace_order
CREATE OR REPLACE FUNCTION public.qb_create_marketplace_order(p_product_id uuid, p_quantity integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_product public.marketplace_products%rowtype;
    v_order_id uuid;
    v_order_item_id uuid;
    v_order_number text;
    v_quantity integer;
    v_line_total numeric(14,2);
begin

    if auth.uid() is null then
        raise exception 'QB_AUTHENTICATION_REQUIRED';
    end if;

    v_quantity :=
        least(
            greatest(coalesce(p_quantity,1),1),
            100
        );


    select *
    into v_product
    from public.marketplace_products
    where id = p_product_id;


    if not found then
        raise exception 'QB_PRODUCT_NOT_FOUND';
    end if;


    if upper(v_product.status) <> 'PUBLISHED'
       or upper(v_product.moderation_status) <> 'APPROVED'
    then
        raise exception 'QB_PRODUCT_NOT_AVAILABLE';
    end if;


    v_line_total :=
        v_product.price * v_quantity;


    v_order_number :=
        'QB-' ||
        upper(
            substr(
                replace(
                    gen_random_uuid()::text,
                    '-',
                    ''
                ),
                1,
                12
            )
        );


    insert into public.orders(
        tenant_id,
        buyer_user_id,
        order_number,
        currency,
        subtotal,
        discount_amount,
        total_amount,
        payment_status,
        fulfillment_status,
        status
    )
    values(
        v_product.tenant_id,
        auth.uid(),
        v_order_number,
        v_product.currency,
        v_line_total,
        0,
        v_line_total,
        'UNPAID',
        'PENDING',
        'OPEN'
    )
    returning id
    into v_order_id;


    insert into public.order_items(
        order_id,
        product_id,
        seller_id,
        quantity,
        unit_price,
        line_total
    )
    values(
        v_order_id,
        v_product.id,
        v_product.seller_id,
        v_quantity,
        v_product.price,
        v_line_total
    )
    returning id
    into v_order_item_id;


    insert into public.analytics_events(
        tenant_id,
        user_id,
        event_name,
        entity_type,
        entity_id,
        properties
    )
    values(
        v_product.tenant_id,
        auth.uid(),
        'MARKETPLACE_ORDER_CREATED',
        'ORDER',
        v_order_id,
        jsonb_build_object(
            'product_id',v_product.id,
            'quantity',v_quantity,
            'amount',v_line_total,
            'currency',v_product.currency
        )
    );


    return jsonb_build_object(
        'status','PASS',
        'order_id',v_order_id,
        'order_number',v_order_number,
        'order_item_id',v_order_item_id,
        'amount',v_line_total,
        'currency',v_product.currency,
        'payment_status','UNPAID'
    );

end;
$function$
;

-- FUNCTION public.qb_current_student_id
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
;

-- FUNCTION public.qb_current_teacher_id
CREATE OR REPLACE FUNCTION public.qb_current_teacher_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select tp.id
    from public.teacher_profiles tp
    where tp.user_id = auth.uid()
    limit 1;
$function$
;

-- FUNCTION public.qb_finalize_competition_leaderboard
CREATE OR REPLACE FUNCTION public.qb_finalize_competition_leaderboard(p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_updated integer := 0;
begin if not quizbox_market.competition_allowed(p_competition_id) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;

    if not (
        public.qb_has_permission(
            'COMPETITION_MANAGE'
        )
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    with ranked as (

        select
            cr.id,

            dense_rank() over (
                order by
                    cr.score desc,
                    coalesce(
                        cr.percentage,
                        0
                    ) desc,
                    coalesce(
                        cr.completion_time_ms,
                        9223372036854775807
                    ) asc
            ) as new_rank

        from public.competition_results cr

        where cr.competition_id =
            p_competition_id

          and upper(cr.result_status) in (
              'FINAL',
              'PROVISIONAL'
          )
    )

    update public.competition_results cr

    set
        rank = ranked.new_rank,
        result_status = 'FINAL',
        calculated_at = now()

    from ranked

    where cr.id = ranked.id;


    get diagnostics v_updated =
        row_count;


    return jsonb_build_object(
        'status','PASS',
        'competition_id',p_competition_id,
        'ranked_results',v_updated
    );

end;
$function$
;

-- FUNCTION public.qb_get_attempt
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
;

-- FUNCTION public.qb_get_question_media
CREATE OR REPLACE FUNCTION public.qb_get_question_media(p_question_id uuid)
 RETURNS TABLE(media_asset_id uuid, usage_type text, option_key text, display_order integer, storage_bucket text, storage_path text, media_type text, mime_type text, width integer, height integer, alt_text text, caption text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        ma.id,
        qm.usage_type,
        qm.option_key,
        qm.display_order,

        ma.storage_bucket,
        ma.storage_path,

        ma.media_type,
        ma.mime_type,

        ma.width,
        ma.height,

        ma.alt_text,
        ma.caption
    from public.question_media qm
    join public.media_assets ma
        on ma.id = qm.media_asset_id
    join public.questions q
        on q.id = qm.question_id
    where
        qm.question_id = p_question_id
        and q.status = 'active'
        and ma.status = 'ACTIVE'
    order by qm.display_order;
$function$
;

-- FUNCTION public.qb_get_question_options
CREATE OR REPLACE FUNCTION public.qb_get_question_options(p_question_id uuid)
 RETURNS TABLE(id uuid, option_key text, display_order integer, content jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        qo.id,
        qo.option_key,
        qo.display_order,
        qo.content
    from public.question_options qo
    join public.questions q
        on q.id = qo.question_id
    where
        qo.question_id = p_question_id
        and q.status = 'active'
    order by qo.display_order;
$function$
;

-- FUNCTION public.qb_get_questions
CREATE OR REPLACE FUNCTION public.qb_get_questions(p_subject_code text DEFAULT NULL::text, p_grade text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, external_question_id text, subject_code text, subject_name text, grade qb_grade, strand_no text, strand_name text, substrand_no text, substrand_name text, content_standard_code text, content_standard_text text, indicator_code text, indicator_text text, difficulty_code text, difficulty_label text, cognitive_level text, question_code text, question_text text, question_content jsonb, answer_type text, option_a text, option_b text, option_c text, option_d text, marks numeric, estimated_time_seconds integer, tags text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        q.id,
        q.external_question_id,

        q.subject_code,
        q.subject_name,
        q.grade,

        q.strand_no,
        q.strand_name,

        q.substrand_no,
        q.substrand_name,

        q.content_standard_code,
        q.content_standard_text,

        q.indicator_code,
        q.indicator_text,

        q.difficulty_code,
        q.difficulty_label,
        q.cognitive_level,

        q.question_code,

        q.question_text,
        q.question_content,

        q.answer_type,

        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,

        q.marks,
        q.estimated_time_seconds,

        q.tags
    from public.questions q
    where
        q.status = 'active' and auth.uid() is not null and public.qb_question_is_available(q)
        and (
            p_subject_code is null
            or q.subject_code = p_subject_code
        )
        and (
            p_grade is null
            or q.grade::text = p_grade
        )
    order by random()
    limit least(
        greatest(coalesce(p_limit, 20), 1),
        100
    );
$function$
;

-- FUNCTION public.qb_get_result
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
;

-- FUNCTION public.qb_grade_response
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
;

-- FUNCTION public.qb_has_permission
CREATE OR REPLACE FUNCTION public.qb_has_permission(p_permission_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        public.qb_is_platform_admin()
        or exists (
            select 1
            from public.role_permissions rp
            join public.permissions p
              on p.id = rp.permission_id
            where upper(rp.role) = public.qb_current_role()
              and upper(p.code) = upper(p_permission_code)
              and rp.allowed = true
        );
$function$
;

-- FUNCTION public.qb_is_class_member
CREATE OR REPLACE FUNCTION public.qb_is_class_member(p_class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$select quizbox_market.class_allowed(p_class_id) and coalesce((
    select exists (
        select 1
        from public.class_memberships cm
        where cm.class_id = p_class_id
          and cm.student_id = public.qb_current_student_id()
          and lower(cm.status::text) = 'active'
    )),false);$function$
;

-- FUNCTION public.qb_is_tenant_member
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
;

-- FUNCTION public.qb_managed_class_context
CREATE OR REPLACE FUNCTION public.qb_managed_class_context(p_class uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.classes;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into c from public.classes where id = p_class;
  if c.id is null or lower(c.status::text) <> 'active' or not (c.teacher_user_id = auth.uid() or public.qb_is_platform_admin()) then raise exception 'QB_CLASS_NOT_MANAGED' using errcode = '42501'; end if;
  return jsonb_build_object('class_id', c.id, 'class_name', c.class_name, 'grade', c.grade::text, 'grade_label', c.grade_label, 'school', c.school_name);
end $function$
;

-- FUNCTION public.qb_managed_learner_archive
CREATE OR REPLACE FUNCTION public.qb_managed_learner_archive(p_learner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.qb_managed_learner_authorise(auth.uid(), p_learner) then raise exception 'QB_MANAGED_LEARNER_NOT_FOUND' using errcode = '42501'; end if;
  update public.student_profiles set status = 'inactive', archived_at = now() where user_id = p_learner;
  update public.class_memberships set status = 'inactive' where student_user_id = p_learner;
  update public.profiles set status = 'inactive' where id = p_learner;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), 'QB_MANAGED_LEARNER_ARCHIVED', 'profiles', p_learner, 'pass', '{}'::jsonb);
  return jsonb_build_object('archived', true);
end $function$
;

-- FUNCTION public.qb_managed_learner_authorise
CREATE OR REPLACE FUNCTION public.qb_managed_learner_authorise(p_teacher uuid, p_learner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.student_profiles sp where sp.user_id = p_learner and sp.managed_by is not null and sp.is_minor
                   and (sp.managed_by = p_teacher or exists (select 1 from public.class_memberships m join public.classes c on c.id = m.class_id where m.student_user_id = p_learner and c.teacher_user_id = p_teacher)))
$function$
;

-- FUNCTION public.qb_managed_learner_list
CREATE OR REPLACE FUNCTION public.qb_managed_learner_list(p_class uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.classes c where c.id = p_class and (c.teacher_user_id = auth.uid() or public.qb_is_platform_admin())) then raise exception 'QB_CLASS_NOT_MANAGED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'first_name', p.full_name, 'username', split_part(p.email, '@', 1), 'status', sp.status::text, 'created_at', sp.created_at,
      'archived_at', sp.archived_at) order by p.full_name)
    from public.class_memberships m join public.student_profiles sp on sp.user_id = m.student_user_id join public.profiles p on p.id = sp.user_id
   where m.class_id = p_class and sp.managed_by is not null), '[]'::jsonb);
end $function$
;

-- FUNCTION public.qb_managed_learner_provision
CREATE OR REPLACE FUNCTION public.qb_managed_learner_provision(p_teacher uuid, p_class uuid, p_user uuid, p_first_name text, p_username text, p_consent_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.classes; t public.profiles; first text := btrim(coalesce(p_first_name, '')); sp public.student_profiles; grade_code text; mkt uuid; country text;
begin
  select * into c from public.classes where id = p_class;
  select * into t from public.profiles where id = p_teacher;
  if c.id is null or t.id is null or lower(c.status::text) <> 'active' or c.teacher_user_id <> p_teacher then raise exception 'QB_CLASS_NOT_MANAGED' using errcode = '42501'; end if;
  if char_length(first) not between 2 and 40 or first !~ '^[A-Za-z][A-Za-z '' -]*$' then raise exception 'QB_MANAGED_NAME_INVALID'; end if;
  if p_username !~ '^[a-z][a-z0-9.]{3,30}$' then raise exception 'QB_MANAGED_USERNAME_INVALID'; end if;
  if char_length(btrim(coalesce(p_consent_ref, ''))) < 5 then raise exception 'QB_MANAGED_CONSENT_REQUIRED'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'AUTH_REQUIRED'; end if;
  grade_code := c.grade::text; mkt := coalesce(t.primary_market_id, t.default_market_id); country := t.country;
  -- the sign-in trigger may already have made a basic profile; make it the managed learner's profile
  insert into public.profiles(id, role, full_name, email, status, country, school_name, default_market_id, primary_market_id, onboarding_completed_at)
  values (p_user, 'student', first, (select email from auth.users where id = p_user), 'active', coalesce(country, 'Ghana'), c.school_name, mkt, mkt, now())
  on conflict (id) do update set role = 'student', full_name = excluded.full_name, status = 'active', country = excluded.country, school_name = excluded.school_name,
      default_market_id = excluded.default_market_id, primary_market_id = excluded.primary_market_id, onboarding_completed_at = excluded.onboarding_completed_at;
  insert into public.student_profiles(user_id, grade, school_name, country, status, managed_by, is_minor)
  values (p_user, c.grade, c.school_name, coalesce(country, 'Ghana'), 'active', p_teacher, true)
  on conflict (user_id) do update set grade = excluded.grade, school_name = excluded.school_name, status = 'active', managed_by = excluded.managed_by, is_minor = true, archived_at = null
  returning * into sp;
  if mkt is not null then insert into public.user_market_memberships(user_id, market_id, active) values (p_user, mkt, true) on conflict (user_id, market_id) do update set active = true; end if;
  insert into public.class_memberships(class_id, student_id, student_user_id, student_email, student_name, grade, status, approved_at)
  values (c.id, sp.id, p_user, p_username, first, c.grade, 'active', now())
  on conflict do nothing;
  insert into public.learner_consent(user_id, status, policy_ref, decided_by, decided_at)
  values (p_user, 'granted', 'school-attested: ' || left(btrim(p_consent_ref), 120), p_teacher, now())
  on conflict (user_id) do update set status = 'granted', policy_ref = excluded.policy_ref, decided_by = excluded.decided_by, decided_at = excluded.decided_at, updated_at = now();
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
  values (p_teacher, 'QB_MANAGED_LEARNER_CREATED', 'profiles', p_user, 'pass', jsonb_build_object('class', c.id, 'username', p_username));
  return jsonb_build_object('user_id', p_user, 'student_id', sp.id, 'class_id', c.id, 'username', p_username, 'first_name', first);
end $function$
;

-- FUNCTION public.qb_marketplace_catalog
CREATE OR REPLACE FUNCTION public.qb_marketplace_catalog()
 RETURNS TABLE(id uuid, product_type text, title text, description text, subject_code text, grade text, license_type text, price numeric, currency text, seller_display_name text, seller_verification_status text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        mp.id,
        mp.product_type,
        mp.title,
        mp.description,
        mp.subject_code,
        mp.grade,
        mp.license_type,
        mp.price,
        mp.currency,
        ms.display_name,
        ms.verification_status,
        mp.created_at
    from public.marketplace_products mp
    join public.marketplace_sellers ms
      on ms.id = mp.seller_id
    where upper(mp.status) = 'PUBLISHED'
      and upper(mp.moderation_status) = 'APPROVED'
      and upper(ms.status) = 'ACTIVE'
    order by mp.created_at desc;
$function$
;

-- FUNCTION public.qb_my_results
CREATE OR REPLACE FUNCTION public.qb_my_results(p_limit integer DEFAULT 50)
 RETURNS SETOF assessment_results
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

    select *
    from public.assessment_results
    where student_id =
        public.qb_current_student_id()

    order by
        submitted_at desc nulls last

    limit least(
        greatest(
            coalesce(p_limit,50),
            1
        ),
        200
    );

$function$
;

-- FUNCTION public.qb_normalize_text
CREATE OR REPLACE FUNCTION public.qb_normalize_text(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select upper(
        regexp_replace(
            trim(coalesce(p_value,'')),
            '\\s+',
            ' ',
            'g'
        )
    );
$function$
;

-- FUNCTION public.qb_protect_assessment_snapshot
CREATE OR REPLACE FUNCTION public.qb_protect_assessment_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin

    if
        old.question_text_snapshot
            is distinct from
        new.question_text_snapshot

        or old.option_a_snapshot
            is distinct from
        new.option_a_snapshot

        or old.option_b_snapshot
            is distinct from
        new.option_b_snapshot

        or old.option_c_snapshot
            is distinct from
        new.option_c_snapshot

        or old.option_d_snapshot
            is distinct from
        new.option_d_snapshot

        or old.correct_answer_snapshot
            is distinct from
        new.correct_answer_snapshot

        or old.marks_snapshot
            is distinct from
        new.marks_snapshot

        or old.question_content_snapshot
            is distinct from
        new.question_content_snapshot

        or old.answer_type_snapshot
            is distinct from
        new.answer_type_snapshot

        or old.answer_spec_snapshot
            is distinct from
        new.answer_spec_snapshot

        or old.options_snapshot
            is distinct from
        new.options_snapshot

        or old.media_snapshot
            is distinct from
        new.media_snapshot

    then
        raise exception
            'ASSESSMENT_SNAPSHOT_IMMUTABLE';
    end if;

    return new;
end;
$function$
;

-- FUNCTION public.qb_public_tenant_id
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
;

-- FUNCTION public.qb_record_competition_result
CREATE OR REPLACE FUNCTION public.qb_record_competition_result(p_competition_id uuid, p_entity_type text, p_entity_id uuid, p_score numeric, p_percentage numeric DEFAULT NULL::numeric, p_completion_time_ms bigint DEFAULT NULL::bigint, p_stage_id uuid DEFAULT NULL::uuid, p_round_id uuid DEFAULT NULL::uuid, p_match_id uuid DEFAULT NULL::uuid, p_result_status text DEFAULT 'PROVISIONAL'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_result_id uuid;
begin if not quizbox_market.competition_allowed(p_competition_id) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;

    if not (
        public.qb_has_permission(
            'COMPETITION_MANAGE'
        )
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    if upper(p_entity_type) not in (
        'STUDENT',
        'TEAM',
        'INSTITUTION'
    ) then
        raise exception
            'QB_INVALID_COMPETITION_ENTITY_TYPE';
    end if;


    /*
     * Update an existing result at the same competition
     * stage/round/match/entity position first.
     */

    select id
    into v_result_id
    from public.competition_results
    where competition_id = p_competition_id
      and entity_type = upper(p_entity_type)
      and entity_id = p_entity_id
      and stage_id is not distinct from p_stage_id
      and round_id is not distinct from p_round_id
      and match_id is not distinct from p_match_id
    limit 1;


    if v_result_id is null then

        insert into public.competition_results(
            competition_id,
            stage_id,
            round_id,
            match_id,

            entity_type,
            entity_id,

            score,
            percentage,
            completion_time_ms,

            result_status,
            calculated_at
        )
        values(
            p_competition_id,
            p_stage_id,
            p_round_id,
            p_match_id,

            upper(p_entity_type),
            p_entity_id,

            coalesce(p_score,0),
            p_percentage,
            p_completion_time_ms,

            upper(
                coalesce(
                    p_result_status,
                    'PROVISIONAL'
                )
            ),

            now()
        )
        returning id
        into v_result_id;

    else

        update public.competition_results
        set
            score =
                coalesce(p_score,0),

            percentage =
                p_percentage,

            completion_time_ms =
                p_completion_time_ms,

            result_status =
                upper(
                    coalesce(
                        p_result_status,
                        'PROVISIONAL'
                    )
                ),

            calculated_at =
                now()

        where id =
            v_result_id;

    end if;


    return jsonb_build_object(
        'status','PASS',
        'competition_result_id',v_result_id
    );

end;
$function$
;

-- FUNCTION public.qb_refresh_daily_metrics
CREATE OR REPLACE FUNCTION public.qb_refresh_daily_metrics(p_metric_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    t record;
    written_count integer := 0;
begin

    if not public.qb_is_platform_admin() then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    for t in
        select id
        from public.tenants
        where upper(status) = 'ACTIVE'
    loop

        insert into public.daily_metrics(
            metric_date,
            tenant_id,
            metric_domain,
            metric_name,
            metric_value
        )
        values
        (
            p_metric_date,
            t.id,
            'CONTENT',
            'QUESTION_COUNT',
            (
                select count(*)
                from public.questions q
                where q.tenant_id = t.id
            )
        )
        on conflict (
            metric_date,
            tenant_id,
            metric_domain,
            metric_name
        )
        do update
        set
            metric_value = excluded.metric_value,
            calculated_at = now();

        written_count := written_count + 1;


        insert into public.daily_metrics(
            metric_date,
            tenant_id,
            metric_domain,
            metric_name,
            metric_value
        )
        values
        (
            p_metric_date,
            t.id,
            'CONTENT',
            'QUESTION_BANK_COUNT',
            (
                select count(*)
                from public.question_banks qb
                where qb.tenant_id = t.id
            )
        )
        on conflict (
            metric_date,
            tenant_id,
            metric_domain,
            metric_name
        )
        do update
        set
            metric_value = excluded.metric_value,
            calculated_at = now();

        written_count := written_count + 1;


        insert into public.daily_metrics(
            metric_date,
            tenant_id,
            metric_domain,
            metric_name,
            metric_value
        )
        values
        (
            p_metric_date,
            t.id,
            'CLASSROOM',
            'CLASS_COUNT',
            (
                select count(*)
                from public.classes c
                where c.tenant_id = t.id
            )
        )
        on conflict (
            metric_date,
            tenant_id,
            metric_domain,
            metric_name
        )
        do update
        set
            metric_value = excluded.metric_value,
            calculated_at = now();

        written_count := written_count + 1;


        insert into public.daily_metrics(
            metric_date,
            tenant_id,
            metric_domain,
            metric_name,
            metric_value
        )
        values
        (
            p_metric_date,
            t.id,
            'ASSESSMENT',
            'ASSESSMENT_COUNT',
            (
                select count(*)
                from public.assessments a
                where a.tenant_id = t.id
            )
        )
        on conflict (
            metric_date,
            tenant_id,
            metric_domain,
            metric_name
        )
        do update
        set
            metric_value = excluded.metric_value,
            calculated_at = now();

        written_count := written_count + 1;


        insert into public.daily_metrics(
            metric_date,
            tenant_id,
            metric_domain,
            metric_name,
            metric_value
        )
        values
        (
            p_metric_date,
            t.id,
            'COMPETITION',
            'COMPETITION_COUNT',
            (
                select count(*)
                from public.competitions c
                where c.tenant_id = t.id
            )
        )
        on conflict (
            metric_date,
            tenant_id,
            metric_domain,
            metric_name
        )
        do update
        set
            metric_value = excluded.metric_value,
            calculated_at = now();

        written_count := written_count + 1;


        insert into public.daily_metrics(
            metric_date,
            tenant_id,
            metric_domain,
            metric_name,
            metric_value
        )
        values
        (
            p_metric_date,
            t.id,
            'MARKETPLACE',
            'PRODUCT_COUNT',
            (
                select count(*)
                from public.marketplace_products mp
                where mp.tenant_id = t.id
            )
        )
        on conflict (
            metric_date,
            tenant_id,
            metric_domain,
            metric_name
        )
        do update
        set
            metric_value = excluded.metric_value,
            calculated_at = now();

        written_count := written_count + 1;

    end loop;


    return jsonb_build_object(
        'status', 'PASS',
        'metric_date', p_metric_date,
        'metrics_written', written_count,
        'completed_at', now()
    );

end;
$function$
;

-- FUNCTION public.qb_register_competition_school
CREATE OR REPLACE FUNCTION public.qb_register_competition_school(p_competition_id uuid, p_institution_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_id uuid;
begin if not quizbox_market.competition_allowed(p_competition_id) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;

    if not (
        public.qb_can_manage_institution(
            p_institution_id
        )
        or public.qb_has_permission(
            'COMPETITION_MANAGE'
        )
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    if not exists (
        select 1
        from public.competitions
        where id = p_competition_id
    ) then
        raise exception 'QB_COMPETITION_NOT_FOUND';
    end if;


    insert into public.competition_institutions(
        competition_id,
        institution_id,
        registration_status,
        verification_status,
        registered_at
    )
    values(
        p_competition_id,
        p_institution_id,
        'PENDING',
        'PENDING',
        now()
    )

    on conflict(
        competition_id,
        institution_id
    )
    do update
    set
        registration_status =
            excluded.registration_status

    returning id
    into v_id;


    return jsonb_build_object(
        'status','PASS',
        'competition_institution_id',v_id,
        'registration_status','PENDING'
    );

end;
$function$
;

-- FUNCTION public.qb_request_payout
CREATE OR REPLACE FUNCTION public.qb_request_payout(p_seller_id uuid, p_amount numeric, p_payout_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_balance jsonb;
    v_withdrawable numeric;
    v_payout_id uuid;
begin

    if not (
        public.qb_controls_seller(p_seller_id)
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    if p_amount is null
       or p_amount <= 0
    then
        raise exception 'QB_INVALID_PAYOUT_AMOUNT';
    end if;


    if not exists (
        select 1
        from public.payout_accounts pa
        where pa.id = p_payout_account_id
          and pa.seller_id = p_seller_id
          and upper(pa.status) = 'ACTIVE'
    ) then
        raise exception 'QB_PAYOUT_ACCOUNT_INVALID';
    end if;


    v_balance :=
        public.qb_seller_balance(
            p_seller_id
        );


    v_withdrawable :=
        coalesce(
            (v_balance ->> 'withdrawable')::numeric,
            0
        );


    if p_amount > v_withdrawable then
        raise exception 'QB_INSUFFICIENT_SELLER_BALANCE';
    end if;


    insert into public.payouts(
        seller_id,
        payout_account_id,
        currency,
        amount,
        status,
        requested_at
    )
    values(
        p_seller_id,
        p_payout_account_id,
        'GHS',
        p_amount,
        'PENDING',
        now()
    )
    returning id
    into v_payout_id;


    return jsonb_build_object(
        'status','PASS',
        'payout_id',v_payout_id,
        'seller_id',p_seller_id,
        'amount',p_amount,
        'payout_status','PENDING'
    );

end;
$function$
;

-- FUNCTION public.qb_seller_balance
CREATE OR REPLACE FUNCTION public.qb_seller_balance(p_seller_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_available numeric := 0;
    v_pending numeric := 0;
    v_paid numeric := 0;
begin

    if not (
        public.qb_controls_seller(p_seller_id)
        or public.qb_is_platform_admin()
        or public.qb_has_permission('FINANCE_VIEW')
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    select coalesce(
        sum(seller_net_amount),
        0
    )
    into v_available
    from public.seller_earnings
    where seller_id = p_seller_id
      and upper(earning_status) = 'AVAILABLE'
      and (
          available_at is null
          or available_at <= now()
      );


    select coalesce(sum(amount),0)
    into v_pending
    from public.payouts
    where seller_id = p_seller_id
      and upper(status) in (
          'PENDING',
          'PROCESSING'
      );


    select coalesce(sum(amount),0)
    into v_paid
    from public.payouts
    where seller_id = p_seller_id
      and upper(status) in (
          'PAID',
          'COMPLETED',
          'SUCCESS'
      );


    return jsonb_build_object(
        'status','PASS',
        'seller_id',p_seller_id,
        'gross_available',v_available,
        'pending_payouts',v_pending,
        'paid_out',v_paid,
        'withdrawable',
            greatest(
                v_available -
                v_pending -
                v_paid,
                0
            )
    );

end;
$function$
;

-- FUNCTION public.qb_seller_dashboard
CREATE OR REPLACE FUNCTION public.qb_seller_dashboard(p_seller_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
begin

    if not (
        public.qb_controls_seller(p_seller_id)
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    select jsonb_build_object(

        'seller_id',
        p_seller_id,

        'products',
        (
            select count(*)
            from public.marketplace_products mp
            where mp.seller_id = p_seller_id
        ),

        'published_products',
        (
            select count(*)
            from public.marketplace_products mp
            where mp.seller_id = p_seller_id
              and upper(mp.status) = 'PUBLISHED'
        ),

        'orders',
        (
            select count(distinct oi.order_id)
            from public.order_items oi
            where oi.seller_id = p_seller_id
        ),

        'gross_sales',
        (
            select coalesce(sum(se.gross_amount),0)
            from public.seller_earnings se
            where se.seller_id = p_seller_id
        ),

        'platform_fees',
        (
            select coalesce(sum(se.platform_fee),0)
            from public.seller_earnings se
            where se.seller_id = p_seller_id
        ),

        'net_earnings',
        (
            select coalesce(sum(se.seller_net_amount),0)
            from public.seller_earnings se
            where se.seller_id = p_seller_id
        ),

        'available_earnings',
        (
            select coalesce(sum(se.seller_net_amount),0)
            from public.seller_earnings se
            where se.seller_id = p_seller_id
              and upper(se.earning_status) = 'AVAILABLE'
        ),

        'paid_out',
        (
            select coalesce(sum(p.amount),0)
            from public.payouts p
            where p.seller_id = p_seller_id
              and upper(p.status) in (
                  'PAID',
                  'COMPLETED',
                  'SUCCESS'
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

-- FUNCTION public.qb_set_updated_at
CREATE OR REPLACE FUNCTION public.qb_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$
;

-- FUNCTION public.qb_settle_paid_order
CREATE OR REPLACE FUNCTION public.qb_settle_paid_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_order public.orders%rowtype;
    v_item record;

    v_rate numeric := 0;
    v_fee numeric(14,2);
    v_net numeric(14,2);

    v_entitlements integer := 0;
    v_earnings integer := 0;
begin

    if not (
        public.qb_is_platform_admin()
        or public.qb_has_permission('FINANCE_MANAGE')
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    select *
    into v_order
    from public.orders
    where id = p_order_id
    for update;


    if not found then
        raise exception 'QB_ORDER_NOT_FOUND';
    end if;


    -- Idempotency.
    if upper(v_order.fulfillment_status) = 'FULFILLED' then

        return jsonb_build_object(
            'status','PASS',
            'idempotent',true,
            'order_id',p_order_id
        );

    end if;


    /*
     * This RPC assumes the trusted payment layer has verified
     * receipt of funds before calling it.
     */

    update public.orders
    set
        payment_status = 'PAID'
    where id = p_order_id;


    for v_item in

        select
            oi.*,
            mp.product_type,
            mp.tenant_id
        from public.order_items oi
        join public.marketplace_products mp
          on mp.id = oi.product_id
        where oi.order_id = p_order_id

    loop

        -- ----------------------------------------------------
        -- COMMISSION
        -- seller-specific rule first
        -- then generic product-type rule
        -- ----------------------------------------------------

        select coalesce(cr.platform_fee_rate,0)
        into v_rate
        from public.commission_rules cr
        where upper(cr.status) = 'ACTIVE'
          and (
              cr.starts_at is null
              or cr.starts_at <= now()
          )
          and (
              cr.ends_at is null
              or cr.ends_at > now()
          )
          and (
              cr.seller_id = v_item.seller_id
              or cr.seller_id is null
          )
          and (
              cr.product_type = v_item.product_type
              or cr.product_type is null
          )
        order by
            case
                when cr.seller_id = v_item.seller_id
                    then 0
                else 1
            end,
            case
                when cr.product_type = v_item.product_type
                    then 0
                else 1
            end
        limit 1;


        /*
         * Supports either:
         * 0.20 = 20%
         * or
         * 20 = 20%
         */
        if coalesce(v_rate,0) > 1 then
            v_rate := v_rate / 100;
        end if;


        v_rate :=
            greatest(
                least(
                    coalesce(v_rate,0),
                    1
                ),
                0
            );


        v_fee :=
            round(
                v_item.line_total * v_rate,
                2
            );


        v_net :=
            v_item.line_total - v_fee;


        -- ----------------------------------------------------
        -- SELLER EARNING
        -- ----------------------------------------------------

        if not exists (
            select 1
            from public.seller_earnings se
            where se.order_item_id = v_item.id
        ) then

            insert into public.seller_earnings(
                seller_id,
                order_item_id,
                currency,
                gross_amount,
                platform_fee,
                seller_net_amount,
                earning_status,
                available_at
            )
            values(
                v_item.seller_id,
                v_item.id,
                v_order.currency,
                v_item.line_total,
                v_fee,
                v_net,
                'AVAILABLE',
                now()
            );

            v_earnings := v_earnings + 1;

        end if;


        -- ----------------------------------------------------
        -- BUYER ENTITLEMENT
        -- ----------------------------------------------------

        if not exists (
            select 1
            from public.entitlements e
            where e.beneficiary_user_id =
                    v_order.buyer_user_id
              and e.source_type =
                    'ORDER_ITEM'
              and e.source_id =
                    v_item.id
        ) then

            insert into public.entitlements(
                beneficiary_user_id,
                source_type,
                source_id,
                entitlement_type,
                scope,
                starts_at,
                status,
                product_id,
                order_item_id
            )
            values(
                v_order.buyer_user_id,
                'ORDER_ITEM',
                v_item.id,
                'MARKETPLACE_PRODUCT',
                jsonb_build_object(
                    'product_id',v_item.product_id,
                    'product_type',v_item.product_type,
                    'quantity',v_item.quantity
                ),
                now(),
                'ACTIVE',
                v_item.product_id,
                v_item.id
            );

            v_entitlements :=
                v_entitlements + 1;

        end if;

    end loop;


    update public.orders
    set
        payment_status = 'PAID',
        fulfillment_status = 'FULFILLED',
        status = 'COMPLETED'
    where id = p_order_id;


    insert into public.analytics_events(
        tenant_id,
        user_id,
        event_name,
        entity_type,
        entity_id,
        properties
    )
    values(
        v_order.tenant_id,
        v_order.buyer_user_id,
        'MARKETPLACE_ORDER_FULFILLED',
        'ORDER',
        p_order_id,
        jsonb_build_object(
            'amount',v_order.total_amount,
            'currency',v_order.currency,
            'entitlements_created',v_entitlements,
            'seller_earnings_created',v_earnings
        )
    );


    return jsonb_build_object(
        'status','PASS',
        'idempotent',false,
        'order_id',p_order_id,
        'payment_status','PAID',
        'fulfillment_status','FULFILLED',
        'entitlements_created',v_entitlements,
        'seller_earnings_created',v_earnings
    );

end;
$function$
;

-- FUNCTION public.qb_snapshot_assessment_question
CREATE OR REPLACE FUNCTION public.qb_snapshot_assessment_question()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    q public.questions%rowtype;
begin

    select *
    into q
    from public.questions
    where id = new.question_id;

    if not found then
        raise exception 'QB_QUESTION_NOT_FOUND';
    end if;

    new.question_text_snapshot :=
        coalesce(
            new.question_text_snapshot,
            q.question_text
        );

    new.option_a_snapshot :=
        coalesce(new.option_a_snapshot,q.option_a);

    new.option_b_snapshot :=
        coalesce(new.option_b_snapshot,q.option_b);

    new.option_c_snapshot :=
        coalesce(new.option_c_snapshot,q.option_c);

    new.option_d_snapshot :=
        coalesce(new.option_d_snapshot,q.option_d);

    new.correct_answer_snapshot :=
        coalesce(
            new.correct_answer_snapshot,
            q.correct_answer
        );

    new.question_content_snapshot :=
        coalesce(
            new.question_content_snapshot,
            q.question_content
        );

    new.answer_type_snapshot :=
        coalesce(
            new.answer_type_snapshot,
            q.answer_type,
            'SINGLE_CHOICE'
        );

    new.answer_spec_snapshot :=
        coalesce(
            new.answer_spec_snapshot,
            q.answer_spec,
            jsonb_build_object(
                'correct_option',
                q.correct_answer
            )
        );

    new.marks_snapshot :=
        coalesce(
            new.marks_snapshot,
            q.marks,
            1
        );

    if new.options_snapshot is null then

        select jsonb_agg(
            jsonb_build_object(
                'option_key',qo.option_key,
                'display_order',qo.display_order,
                'content',qo.content
            )
            order by qo.display_order
        )
        into new.options_snapshot
        from public.question_options qo
        where qo.question_id = q.id;

    end if;

    if new.media_snapshot is null then

        select jsonb_agg(
            jsonb_build_object(
                'media_asset_id',ma.id,
                'storage_bucket',ma.storage_bucket,
                'storage_path',ma.storage_path,
                'media_type',ma.media_type,
                'mime_type',ma.mime_type,
                'alt_text',ma.alt_text,
                'caption',ma.caption
            )
            order by qm.display_order
        )
        into new.media_snapshot
        from public.question_media qm
        join public.media_assets ma
          on ma.id = qm.media_asset_id
        where qm.question_id = q.id;

    end if;

    
 if tg_op='INSERT' then
  new.source_type_snapshot:=q.source_type;
  new.question_version_snapshot:=q.version;
  new.editorial_approved_snapshot:=coalesce(public.qb_question_is_available(q),false);
 else
  new.source_type_snapshot:=old.source_type_snapshot;
  new.question_version_snapshot:=old.question_version_snapshot;
  new.editorial_approved_snapshot:=old.editorial_approved_snapshot;
 end if;
 return new;

end;
$function$
;

-- FUNCTION public.qb_tenant_dashboard
CREATE OR REPLACE FUNCTION public.qb_tenant_dashboard(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
begin

    if not (
        public.qb_is_platform_admin()
        or public.qb_is_tenant_member(p_tenant_id)
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;

    select jsonb_build_object(

        'tenant',
        (
            select jsonb_build_object(
                'id', t.id,
                'code', t.code,
                'name', t.name,
                'type', t.tenant_type,
                'status', t.status
            )
            from public.tenants t
            where t.id = p_tenant_id
        ),

        'institutions',
        (
            select count(*)
            from public.tenant_institutions ti
            where ti.tenant_id = p_tenant_id
        ),

        'members',
        (
            select count(*)
            from public.tenant_memberships tm
            where tm.tenant_id = p_tenant_id
              and upper(tm.status) = 'ACTIVE'
        ),

        'classes',
        (
            select count(*)
            from public.classes c
            where c.tenant_id = p_tenant_id
        ),

        'questions',
        (
            select count(*)
            from public.questions q
            where q.tenant_id = p_tenant_id
        ),

        'question_banks',
        (
            select count(*)
            from public.question_banks qb
            where qb.tenant_id = p_tenant_id
        ),

        'assessments',
        (
            select count(*)
            from public.assessments a
            where a.tenant_id = p_tenant_id
        ),

        'assignments',
        (
            select count(*)
            from public.assignments a
            where a.tenant_id = p_tenant_id
        ),

        'products',
        (
            select count(*)
            from public.marketplace_products mp
            where mp.tenant_id = p_tenant_id
        ),

        'competitions',
        (
            select count(*)
            from public.competitions c
            where c.tenant_id = p_tenant_id
        ),

        'generated_at',
        now()

    )
    into result;

    return result;
end;
$function$
;

-- FUNCTION public.qb_verify_team_member
CREATE OR REPLACE FUNCTION public.qb_verify_team_member(p_team_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_team_id uuid;
    v_institution_id uuid;
begin if not exists(select 1 from public.competition_team_members m where m.id=p_team_member_id and quizbox_market.team_allowed(m.team_id)) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;

    select
        ctm.team_id,
        ct.institution_id
    into
        v_team_id,
        v_institution_id
    from public.competition_team_members ctm
    join public.competition_teams ct
      on ct.id = ctm.team_id
    where ctm.id = p_team_member_id;


    if not found then
        raise exception 'QB_TEAM_MEMBER_NOT_FOUND';
    end if;


    if not (
        public.qb_can_manage_institution(
            v_institution_id
        )
        or public.qb_has_permission(
            'COMPETITION_MANAGE'
        )
        or public.qb_is_platform_admin()
    ) then
        raise exception 'QB_PERMISSION_DENIED';
    end if;


    update public.competition_team_members
    set
        roster_status = 'VERIFIED',
        verified_by = auth.uid(),
        verified_at = now()
    where id = p_team_member_id;


    return jsonb_build_object(
        'status','PASS',
        'team_member_id',p_team_member_id,
        'roster_status','VERIFIED'
    );

end;
$function$
;

-- FUNCTION public.rls_auto_enable
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

-- FUNCTION quizbox_competition.curriculum_assessment_allowed
CREATE OR REPLACE FUNCTION quizbox_competition.curriculum_assessment_allowed(p_assessment uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;
begin c:=quizbox_market.assessment_context(p_assessment);
 return exists(select 1 from public.assessment_questions where assessment_id=p_assessment) and not exists(select 1 from public.assessment_questions aq where aq.assessment_id=p_assessment and
 (not quizbox_market.question_allowed(aq.question_id,c) or
 (c->>'scope'='LOCAL_MARKET' and quizbox_market.grade_policy_applies(p_assessment) and exists(select 1 from public.profiles where id=auth.uid() and upper(role::text)='STUDENT') and not exists(select 1 from public.student_profiles s join public.questions q on q.id=aq.question_id where s.user_id=auth.uid() and lower(s.status::text)='active' and coalesce(q.canonical_grade_code,case when q.grade::text='B10' then 'SHS1' else q.grade::text end)=quizbox_market.student_grade_code(s.user_id)))));
exception when sqlstate '42501' then return false; end $function$
;

-- FUNCTION quizbox_competition.curriculum_question_allowed
CREATE OR REPLACE FUNCTION quizbox_competition.curriculum_question_allowed(p_question uuid, p_context jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb; q public.questions;
begin
 c:=coalesce(p_context,quizbox_market.resolve_context()); select * into q from public.questions where id=p_question;
 if q.id is null then return false; end if;
 if cardinality(q.source_document_ids)>0 then
  if jsonb_array_length(c->'source_document_ids')=0 then
   return quizbox_market.curriculum_allowed(q.curriculum_id,c) and not exists(select 1 from unnest(q.source_document_ids) s left join public.source_documents d on d.id=s where d.id is null or d.validation_status<>'approved' or d.source_kind<>'CURRICULUM' or d.curriculum_id is distinct from q.curriculum_id or not quizbox_market.document_owned(d.id));
  end if;
  return c->'source_document_ids' @> to_jsonb(q.source_document_ids) and quizbox_market.node_allowed(q.curriculum_node_id,c);
 end if;
 return jsonb_array_length(c->'source_document_ids')=0 and exists(select 1 from public.legacy_content_attributions l where l.question_id=q.id and l.curriculum_id=coalesce(q.curriculum_id,(select n.curriculum_id from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active))) and quizbox_market.curriculum_allowed(coalesce(q.curriculum_id,(select n.curriculum_id from public.curriculum_nodes n where n.id=q.curriculum_node_id and n.is_active)),c);
exception when sqlstate '42501' then return false;
end $function$
;

-- FUNCTION quizbox_competition.curriculum_question_guard
CREATE OR REPLACE FUNCTION quizbox_competition.curriculum_question_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;
begin
 if auth.uid() is null then return new; end if;
 if tg_op='UPDATE' then
  perform quizbox_market.assert_question(old.id);
  if new.curriculum_id is distinct from old.curriculum_id or new.curriculum_node_id is distinct from old.curriculum_node_id or new.source_document_ids is distinct from old.source_document_ids then raise exception 'QB_CONTENT_MAPPING_CHANGE_REQUIRES_REVIEW'; end if;
  return new;
 end if;
 select content_context into c from public.content_import_batches where id=new.import_batch_id;
 if c is null then c:=quizbox_market.resolve_context(); end if;
 if not coalesce(quizbox_market.node_allowed(new.curriculum_node_id,c),false) then raise exception 'QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT' using errcode='42501'; end if;
 if c->'source_document_ids' is null or jsonb_array_length(c->'source_document_ids')=0 then raise exception 'QB_EXPLICIT_APPROVED_SOURCES_REQUIRED'; end if;
 new.source_document_ids:=array(select v::uuid from jsonb_array_elements_text(c->'source_document_ids') v);
 return new;
end $function$
;

-- FUNCTION quizbox_competition.curriculum_validation_errors
CREATE OR REPLACE FUNCTION quizbox_competition.curriculum_validation_errors(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare errors jsonb := '[]'; n public.curriculum_nodes; opts text[]; k text;
begin
 if jsonb_typeof(p) is distinct from 'object' then return '["MALFORMED_CANDIDATE"]'; end if;
 begin select * into n from public.curriculum_nodes where id=(p->>'curriculum_node_id')::uuid; exception when invalid_text_representation then null; end;
 if n.id is null or not n.is_active or n.node_type not in ('learning_indicator','learning_objective') then errors:=errors||'"INVALID_INDICATOR"'::jsonb; end if;
 if length(trim(coalesce(p->>'question_text','')))=0 then errors:=errors||'"EMPTY_QUESTION"'::jsonb; end if;
 if coalesce(p->>'question_text','') ~* '(correct answer|answer key|the answer is)' then errors:=errors||'"ANSWER_LEAKAGE"'::jsonb; end if;
 if coalesce(p->>'question_text','') ~* '<[^>]*>|javascript:|data:' then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 if p->>'answer_type'='SINGLE_CHOICE' then
   opts:=array[p->>'option_a',p->>'option_b',p->>'option_c',p->>'option_d'];
   if exists(select 1 from unnest(opts) x where nullif(trim(x),'') is null) then errors:=errors||'"EMPTY_OPTION"'::jsonb; end if;
   if (select count(distinct public.qb_factory_normalize(x)) from unnest(opts) x)<>4 then errors:=errors||'"DUPLICATE_OPTIONS"'::jsonb; end if;
   if coalesce(p->>'correct_answer','') not in ('A','B','C','D') then errors:=errors||'"INVALID_ANSWER"'::jsonb; end if;
 elsif p->>'answer_type'='TRUE_FALSE' then
   if jsonb_typeof(p#>'{answer_spec,boolean}') is distinct from 'boolean' or p->>'correct_answer' is distinct from (case when p#>>'{answer_spec,boolean}'='true' then 'A' else 'B' end) or lower(p->>'option_a') is distinct from 'true' or lower(p->>'option_b') is distinct from 'false' then errors:=errors||'"INVALID_BOOLEAN_ANSWER"'::jsonb; end if;
   if p->>'question_text' ~* '\\mnot\\M.*\\m(not|never|no)\\M' then errors:=errors||'"DOUBLE_NEGATIVE"'::jsonb; end if;
 elsif p->>'answer_type' in ('NUMERIC','FRACTION','MULTIPLE_CHOICE','SHORT_TEXT','EXPRESSION') then
   if jsonb_typeof(p->'answer_spec') is distinct from 'object' then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif p->>'answer_type'='NUMERIC' and jsonb_typeof(p#>'{answer_spec,value}') is distinct from 'number' then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif p->>'answer_type'='FRACTION' and (jsonb_typeof(p#>'{answer_spec,numerator}') is distinct from 'number' or jsonb_typeof(p#>'{answer_spec,denominator}') is distinct from 'number' or (p#>>'{answer_spec,denominator}')::numeric=0) then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif p->>'answer_type'='MULTIPLE_CHOICE' and (jsonb_typeof(p#>'{answer_spec,correct_options}') is distinct from 'array' or jsonb_array_length(p#>'{answer_spec,correct_options}')=0) then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif p->>'answer_type' in ('SHORT_TEXT','EXPRESSION') and coalesce(p#>>'{answer_spec,value}',p#>>'{answer_spec,canonical}',p#>>'{answer_spec,accepted,0}','')='' then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
 else errors:=errors||'"UNSUPPORTED_ANSWER_TYPE"'::jsonb; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then errors:=errors||'"MISSING_EXPLANATION"'::jsonb; end if;
 if coalesce(p->>'difficulty_label',p->>'difficulty_code','') not in ('easy','medium','hard') then errors:=errors||'"INVALID_DIFFICULTY"'::jsonb; end if;
 if coalesce((p->>'marks')::numeric,0)<=0 or (p->>'marks')::numeric>100 then errors:=errors||'"INVALID_MARKS"'::jsonb; end if;
 if coalesce((p->>'estimated_time_seconds')::integer,0) not between 5 and 3600 then errors:=errors||'"INVALID_DURATION"'::jsonb; end if;
 if coalesce(p->>'source_type','')='' or coalesce(p->>'cognitive_level','')='' then errors:=errors||'"MISSING_PROVENANCE_OR_COGNITIVE_LEVEL"'::jsonb; end if;
 if p->'question_content' is not null and p->'question_content'<>'null'::jsonb then
   if jsonb_typeof(p->'question_content')<>'object' or jsonb_typeof(p#>'{question_content,blocks}') is distinct from 'array' then errors:=errors||'"UNSAFE_CONTENT"'::jsonb;
   else for k in select value->>'type' from jsonb_array_elements(p#>'{question_content,blocks}') loop if k not in ('text','math','image') or k is null then errors:=errors||'"UNSUPPORTED_MEDIA"'::jsonb; end if; end loop; end if;
 end if;

 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b where
 (b->>'type'='text' and (jsonb_typeof(b->'text') is distinct from 'string' or b->>'text' ~* '<[^>]*>|javascript:|data:')) or
 (b->>'type'='math' and (jsonb_typeof(b->'latex') is distinct from 'string' or b->>'latex' ~* '\\\\(href|html|includegraphics)'))) then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;

 if jsonb_typeof(p->'question_content')='object' and exists(select 1 from jsonb_object_keys(p->'question_content') content_keys(key_name) where content_keys.key_name<>'blocks') then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b
 cross join lateral jsonb_object_keys(case when jsonb_typeof(b)='object' then b else '{}'::jsonb end) block_keys(key_name)
 where block_keys.key_name<>all(case when b->>'type'='text' then array['type','text'] when b->>'type'='image' then array['type','asset_id','alt'] else array['type','latex','display'] end)) then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b where b->>'type'='text' and b->>'text' ~* '(correct answer|answer key|the answer is)') then errors:=errors||'"ANSWER_LEAKAGE"'::jsonb; end if;

 if length(coalesce(p->>'external_question_id','')) not between 1 and 250 then errors:=errors||'"INVALID_EXTERNAL_ID"'::jsonb; end if;
 if p->>'answer_type'='NUMERIC' and p->'answer_spec' ? 'tolerance' and
 (jsonb_typeof(p#>'{answer_spec,tolerance}') is distinct from 'number' or (p#>>'{answer_spec,tolerance}')::numeric<0) then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
 if p->>'answer_type' in ('SHORT_TEXT','EXPRESSION') then
  if p->'answer_spec' ? 'accepted' then
   if jsonb_typeof(p#>'{answer_spec,accepted}') is distinct from 'array' then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb;
   elsif jsonb_array_length(p#>'{answer_spec,accepted}')=0 or exists(select 1 from jsonb_array_elements(p#>'{answer_spec,accepted}') a where jsonb_typeof(a)<>'string' or nullif(trim(a#>>'{}'),'') is null) then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
  elsif nullif(trim(p#>>array['answer_spec',case when p->>'answer_type'='SHORT_TEXT' then 'value' else 'canonical' end]),'') is null then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
 end if;
 if p->>'answer_type'='MULTIPLE_CHOICE' and jsonb_typeof(p#>'{answer_spec,correct_options}')='array' then
  if exists(select 1 from jsonb_array_elements(p#>'{answer_spec,correct_options}') a where jsonb_typeof(a)<>'string' or upper(a#>>'{}') not in ('A','B','C','D'))
  or (select count(distinct upper(a#>>'{}')) from jsonb_array_elements(p#>'{answer_spec,correct_options}') a)<>jsonb_array_length(p#>'{answer_spec,correct_options}')
  or exists(select 1 from unnest(array[p->>'option_a',p->>'option_b',p->>'option_c',p->>'option_d']) x where nullif(trim(x),'') is null)
  then errors:=errors||'"INVALID_ANSWER_SPEC"'::jsonb; end if;
 end if;

 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b where b->>'type'='image' and (
 jsonb_typeof(b->'asset_id') is distinct from 'string' or coalesce(b->>'alt','')='' or b->>'alt' ~* '(correct answer|answer key|the answer is)|<[^>]*>' or not exists(
 select 1 from public.media_assets ma where ma.id=(b->>'asset_id')::uuid and ma.validated_at is not null and ma.byte_size between 1 and 5242880 and ma.width between 1 and 4096 and ma.height between 1 and 4096 and ma.storage_bucket='question-media' and ma.status='ACTIVE' and ma.mime_type in ('image/png','image/jpeg','image/webp')
 ))) then errors:=errors||'"UNSUPPORTED_MEDIA"'::jsonb; end if;
 return errors;
exception when invalid_text_representation or numeric_value_out_of_range then return errors||'"MALFORMED_CANDIDATE"'::jsonb;
end $function$
;

-- FUNCTION quizbox_competition.dispatch_authoring
CREATE OR REPLACE FUNCTION quizbox_competition.dispatch_authoring(p_action text, p_sponsor uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; s uuid; c uuid; d uuid; role_name text; member_id uuid;
 config jsonb; expected integer; changed integer; market uuid; country uuid;
 token uuid; state text; context public.content_contexts; source public.source_documents;
 job uuid; spec jsonb; source_ids uuid[]; market_ids uuid[]; validated jsonb; job_row quizbox_competition.generation_jobs;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>1500000 then raise exception 'INVALID_SPONSOR_INPUT'; end if;
 if p_action='create_organization' then
  if not exists(select 1 from public.profiles where id=auth.uid() and upper(role::text)='SPONSOR') and not quizbox_market.is_super() then raise exception 'SPONSOR_ROLE_REQUIRED' using errcode='42501'; end if;
  market:=(p_data->>'market_id')::uuid; country:=(p_data->>'country_id')::uuid;
  if not quizbox_market.market_allowed(market) or not exists(select 1 from public.markets where id=market and country_id=country and active) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
  if nullif(btrim(p_data->>'organization_name'),'') is null or nullif(btrim(p_data->>'organization_type'),'') is null or nullif(btrim(p_data->>'contact_email'),'') is null then raise exception 'ORGANIZATION_FIELDS_REQUIRED'; end if;
  -- Existing profile may be linked once by its original user; no role promotion.
  select id into s from public.sponsor_profiles where user_id=auth.uid() order by created_at limit 1 for update;
  if s is not null and exists(select 1 from quizbox_competition.sponsor_organizations where sponsor_id=s) then raise exception 'SPONSOR_ORGANIZATION_ALREADY_EXISTS'; end if;
  if s is null then
   insert into public.sponsor_profiles(user_id,organization_name,contact_name,status) values(auth.uid(),p_data->>'organization_name',p_data->>'contact_name','PENDING') returning id into s;
  else
   update public.sponsor_profiles set organization_name=p_data->>'organization_name',contact_name=p_data->>'contact_name',updated_at=now() where id=s;
  end if;
  insert into quizbox_competition.sponsor_organizations(sponsor_id,organization_type,country_id,market_id,website,contact_email,contact_phone)
  values(s,p_data->>'organization_type',country,market,p_data->>'website',p_data->>'contact_email',p_data->>'contact_phone');
  insert into quizbox_competition.organization_members(sponsor_id,user_id,role) values(s,auth.uid(),'sponsor_owner');
  return jsonb_build_object('sponsor_id',s);
 end if;
 if p_action='list_organizations' then
  return coalesce((select jsonb_agg(jsonb_build_object('sponsor_id',o.sponsor_id,'organization_name',s.organization_name,'organization_type',o.organization_type,'status',s.status,'market_id',o.market_id,'country_id',o.country_id,'role',m.role))
   from quizbox_competition.sponsor_organizations o join public.sponsor_profiles s on s.id=o.sponsor_id left join quizbox_competition.organization_members m on m.sponsor_id=o.sponsor_id and m.user_id=auth.uid() and m.active
   where m.user_id is not null and quizbox_market.market_allowed(o.market_id) or quizbox_market.is_super()),'[]');
 end if;
 role_name:=quizbox_competition.require_member(p_sponsor,p_action not in ('organization','list_drafts','draft','documents','source_detail','jobs','generation_sources'),p_action in ('edit_organization','member','sponsor_status'));
 if p_action='organization' then
  select to_jsonb(o)||jsonb_build_object('organization_name',s.organization_name,'contact_name',s.contact_name,'status',s.status,'role',role_name,
  'members',coalesce((select jsonb_agg(to_jsonb(m)) from quizbox_competition.organization_members m where m.sponsor_id=o.sponsor_id),'[]')) into result
  from quizbox_competition.sponsor_organizations o join public.sponsor_profiles s on s.id=o.sponsor_id where o.sponsor_id=p_sponsor;
  return result;
 elsif p_action='edit_organization' then
  if nullif(btrim(p_data->>'organization_name'),'') is null or nullif(btrim(p_data->>'contact_email'),'') is null then raise exception 'ORGANIZATION_FIELDS_REQUIRED'; end if;
  update public.sponsor_profiles set organization_name=p_data->>'organization_name',contact_name=p_data->>'contact_name',updated_at=now() where id=p_sponsor;
  update quizbox_competition.sponsor_organizations set website=p_data->>'website',contact_email=p_data->>'contact_email',contact_phone=p_data->>'contact_phone',updated_at=now() where sponsor_id=p_sponsor;
  return jsonb_build_object('saved',true);
 elsif p_action='sponsor_status' then
  if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_data->>'status' not in ('pending','active','suspended','archived') then raise exception 'INVALID_SPONSOR_STATUS'; end if;
  update public.sponsor_profiles set status=upper(p_data->>'status'),updated_at=now() where id=p_sponsor;
  return jsonb_build_object('saved',true);
 elsif p_action='member' then
  -- Serialize membership changes so concurrent removals cannot remove all owners.
  perform 1 from quizbox_competition.sponsor_organizations where sponsor_id=p_sponsor for update;
  member_id:=(p_data->>'user_id')::uuid;
  if p_data->>'role' not in ('sponsor_owner','sponsor_admin','sponsor_editor','sponsor_viewer') then raise exception 'INVALID_SPONSOR_ROLE'; end if;
  if role_name='sponsor_admin' and (p_data->>'role'='sponsor_owner' or exists(select 1 from quizbox_competition.organization_members where sponsor_id=p_sponsor and user_id=member_id and role='sponsor_owner')) then raise exception 'OWNER_MANAGEMENT_REQUIRED' using errcode='42501'; end if;
  if exists(select 1 from quizbox_competition.organization_members where sponsor_id=p_sponsor and user_id=member_id and role='sponsor_owner' and active)
  and (p_data->>'role'<>'sponsor_owner' or not coalesce((p_data->>'active')::boolean,true))
  and not exists(select 1 from quizbox_competition.organization_members where sponsor_id=p_sponsor and user_id<>member_id and role='sponsor_owner' and active) then raise exception 'LAST_OWNER_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=member_id and lower(status::text)='active') then raise exception 'ACTIVE_MEMBER_REQUIRED'; end if;
  insert into quizbox_competition.organization_members(sponsor_id,user_id,role,active) values(p_sponsor,member_id,p_data->>'role',coalesce((p_data->>'active')::boolean,true))
  on conflict(sponsor_id,user_id) do update set role=excluded.role,active=excluded.active,updated_at=now();
  return jsonb_build_object('saved',true);
 elsif p_action='list_drafts' then
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from quizbox_competition.drafts x where sponsor_id=p_sponsor),'[]');
 elsif p_action='save_draft' then
  config:=p_data->'configuration'; c:=nullif(p_data->>'competition_id','')::uuid;
  if jsonb_typeof(config)<>'object' or nullif(btrim(config->>'title'),'') is null then raise exception 'COMPETITION_TITLE_REQUIRED'; end if;
  if c is null then
   insert into public.competitions(sponsor_id,title,description,created_by,status) values(p_sponsor,config->>'title',config->>'description',auth.uid(),'DRAFT') returning id into c;
   insert into quizbox_competition.drafts(competition_id,sponsor_id,created_by,configuration) values(c,p_sponsor,auth.uid(),config) returning to_jsonb(drafts.*) into result;
  else
   if exists(select 1 from quizbox_competition.snapshots where competition_id=c) then raise exception 'COMPETITION_FROZEN'; end if;
   expected:=(p_data->>'revision')::integer;
   update quizbox_competition.drafts set configuration=config,revision=revision+1,updated_at=now() where competition_id=c and sponsor_id=p_sponsor and revision=expected returning to_jsonb(drafts.*) into result;
   if result is null then raise exception 'DRAFT_CONFLICT_OR_ACCESS_DENIED'; end if;
   update public.competitions set title=config->>'title',description=config->>'description',updated_at=now() where id=c and sponsor_id=p_sponsor;
  end if;
  return result;
 end if;
 c:=(p_data->>'competition_id')::uuid;
 if not exists(select 1 from quizbox_competition.drafts where competition_id=c and sponsor_id=p_sponsor) then raise exception 'COMPETITION_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='draft' then return (select to_jsonb(x) from quizbox_competition.drafts x where competition_id=c);
 elsif p_action='documents' then
  return coalesce((select jsonb_agg((to_jsonb(doc)-'extraction_token')||jsonb_build_object('title',src.title,'approval_status',src.validation_status)) from quizbox_competition.documents doc join public.source_documents src on src.id=doc.id where doc.competition_id=c),'[]');
 elsif p_action='jobs' then
  return coalesce((select jsonb_agg(to_jsonb(j)-'execution_token' order by created_at desc) from quizbox_competition.generation_jobs j where competition_id=c),'[]');
 end if;
 if p_action<>'source_detail' and exists(select 1 from quizbox_competition.snapshots where competition_id=c) then raise exception 'COMPETITION_FROZEN'; end if;
 if p_action='queue_generation' then
  spec:=p_data->'spec';
  if jsonb_typeof(spec)<>'object' or nullif(spec->>'provider','') is null or nullif(spec->>'model','') is null or (spec->>'count')::integer not between 1 and 500 then raise exception 'INVALID_GENERATION_INPUT'; end if;
  if not exists(select 1 from public.sponsor_profiles where id=p_sponsor and lower(status)='active') then raise exception 'SPONSOR_NOT_ACTIVE'; end if;
  select array_agg(x::uuid) into source_ids from jsonb_array_elements_text(spec->'sourceIds') x;
  select coalesce(array_agg(x::uuid),'{}') into market_ids from jsonb_array_elements_text(spec->'marketIds') x;
  validated:=quizbox_market.validate_context(spec->>'scope',spec->>'sourceMode',market_ids,source_ids);
  if exists(select 1 from public.source_documents src where src.id=any(source_ids) and src.source_kind='SPONSOR_SOURCE' and (src.sponsor_id is distinct from p_sponsor or not exists(select 1 from quizbox_competition.documents doc where doc.id=src.id and doc.competition_id=c and doc.ingestion_status='READY_FOR_GENERATION' and doc.active))) then raise exception 'SOURCE_NOT_READY_OR_NOT_OWNED'; end if;
  insert into quizbox_competition.generation_jobs(competition_id,created_by,input_snapshot,provider,model,requested_count,request_key)
  values(c,auth.uid(),spec||jsonb_build_object('competitionId',c,'sponsorId',p_sponsor,'authorizedContext',validated),spec->>'provider',spec->>'model',(spec->>'count')::integer,(p_data->>'request_key')::uuid)
  on conflict(competition_id,request_key) do nothing returning id into job;
  if job is null then select id into job from quizbox_competition.generation_jobs where competition_id=c and request_key=(p_data->>'request_key')::uuid; end if;
  return jsonb_build_object('id',job);
 elsif p_action in ('claim_generation','generation_sources','finish_generation','fail_generation','cancel_generation') then
  job:=(p_data->>'job_id')::uuid;
  select * into job_row from quizbox_competition.generation_jobs where id=job and competition_id=c for update;
  if job_row.id is null then raise exception 'GENERATION_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='cancel_generation' then
   if job_row.status not in ('QUEUED','PROCESSING') then raise exception 'INVALID_GENERATION_TRANSITION'; end if;
   update quizbox_competition.generation_jobs set status='CANCELLED',execution_token=null,completed_at=now() where id=job;
   return jsonb_build_object('cancelled',true);
  elsif p_action='claim_generation' then
   if job_row.status<>'QUEUED' then raise exception 'GENERATION_NOT_CLAIMABLE'; end if;
   token:=gen_random_uuid(); update quizbox_competition.generation_jobs set status='PROCESSING',execution_token=token,started_at=now() where id=job;
   return jsonb_build_object('token',token,'input',job_row.input_snapshot,'provider',job_row.provider,'model',job_row.model);
  end if;
  if job_row.status<>'PROCESSING' or job_row.execution_token is distinct from (p_data->>'token')::uuid then raise exception 'GENERATION_CLAIM_MISMATCH'; end if;
  spec:=job_row.input_snapshot;
  if p_action='generation_sources' then
   select array_agg(x::uuid) into source_ids from jsonb_array_elements_text(spec->'sourceIds') x;
   select coalesce(array_agg(x::uuid),'{}') into market_ids from jsonb_array_elements_text(spec->'marketIds') x;
   perform quizbox_market.validate_context(spec->>'scope',spec->>'sourceMode',market_ids,source_ids);
   if not exists(select 1 from public.sponsor_profiles where id=p_sponsor and lower(status)='active') then raise exception 'SPONSOR_NOT_ACTIVE'; end if;
   if exists(select 1 from public.source_documents src where src.id=any(source_ids) and src.source_kind='SPONSOR_SOURCE' and (src.sponsor_id is distinct from p_sponsor or not exists(select 1 from quizbox_competition.documents doc where doc.id=src.id and doc.competition_id=c and doc.ingestion_status='READY_FOR_GENERATION' and doc.active))) then raise exception 'SOURCE_NOT_READY_OR_NOT_OWNED'; end if;
   return jsonb_build_object('input',spec,'actor',jsonb_build_object('userId',auth.uid(),'sponsorId',p_sponsor,'role',case when role_name='super_admin' then 'sponsor_admin' else role_name end,'marketIds',market_ids),'sources',coalesce((select jsonb_agg(jsonb_build_object('id',src.id,'kind',case src.source_kind when 'CURRICULUM' then 'curriculum' when 'SPONSOR_SOURCE' then 'sponsor_document' else 'harmonized_concept_pack' end,'market_id',src.market_id,'curriculum_id',src.curriculum_id,'authority_id',src.authority_id,'active',true,'validation_status',src.validation_status)) from public.source_documents src where src.id=any(source_ids)),'[]'),
   'chunks',coalesce((select jsonb_agg(jsonb_build_object('id',ch.id,'documentId',ch.document_id,'text',ch.source_text,'order',ch.position,'page',ch.page,'chapter',ch.chapter,'section',ch.section,'heading',ch.heading)) from quizbox_competition.chunks ch where ch.document_id=any(source_ids)),'[]'));
  elsif p_action='fail_generation' then
   update quizbox_competition.generation_jobs set status='FAILED',error_code='GENERATION_FAILED',execution_token=null,completed_at=now() where id=job;
   return jsonb_build_object('failed',true);
  elsif p_action='finish_generation' then
   if jsonb_typeof(p_data->'candidates')<>'array' or jsonb_array_length(p_data->'candidates')>job_row.requested_count
   or exists(select 1 from jsonb_array_elements(p_data->'candidates') x where x->>'competitionId'<>c::text or x->>'jobId'<>job::text or nullif(btrim(x->>'stem'),'') is null or nullif(btrim(x->>'explanation'),'') is null
    or not exists(select 1 from quizbox_competition.chunks ch join quizbox_competition.documents doc on doc.id=ch.document_id where ch.id=(x->>'sourceChunkId')::uuid and ch.document_id=(x->>'sourceDocumentId')::uuid and doc.competition_id=c and spec->'sourceIds' @> jsonb_build_array(ch.document_id))) then raise exception 'INVALID_GENERATION_OUTPUT'; end if;
   insert into quizbox_competition.candidates(id,competition_id,job_id,source_document_id,source_chunk_id,market_id,curriculum_id,payload,status)
   select (x->>'id')::uuid,c,job,(x->>'sourceDocumentId')::uuid,(x->>'sourceChunkId')::uuid,
   (select src.market_id from public.source_documents src where src.id=(x->>'sourceDocumentId')::uuid),nullif(x->>'curriculumId','')::uuid,
   (x-'status'-'approvedVersionId')||jsonb_build_object('status','GENERATED','approvedVersionId',null),'GENERATED' from jsonb_array_elements(p_data->'candidates') x;
   state:=case when jsonb_array_length(p_data->'candidates')=job_row.requested_count then 'COMPLETED' when jsonb_array_length(p_data->'candidates')>0 then 'PARTIAL' else 'FAILED' end;
   update quizbox_competition.generation_jobs set status=state,completed_at=now(),execution_token=null where id=job;
   return jsonb_build_object('status',state,'candidate_ids',coalesce((select jsonb_agg(id) from quizbox_competition.candidates where job_id=job),'[]'));
  end if;
 end if;
 if p_action='register_source' then
  market:=nullif(p_data->>'market_id','')::uuid;
  if market is not null and not quizbox_market.market_allowed(market) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
  if nullif(btrim(p_data->>'title'),'') is null or (p_data->>'checksum') !~ '^[0-9a-f]{64}$' or not coalesce((p_data->>'rights_confirmed')::boolean,false) or p_data->>'mime_type' not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain') then raise exception 'INVALID_SOURCE_UPLOAD'; end if;
  d:=gen_random_uuid();
  insert into public.source_documents(id,uploaded_by,title,checksum,mime_type,rights_confirmed,sponsor_id,market_id,source_kind,validation_status,storage_bucket,storage_path,metadata)
  values(d,auth.uid(),p_data->>'title',p_data->>'checksum',p_data->>'mime_type',true,p_sponsor,market,'SPONSOR_SOURCE','review','competition-sources',p_sponsor::text||'/'||c::text||'/'||d::text,jsonb_build_object('competition_id',c));
  insert into quizbox_competition.documents(id,competition_id,version,checksum,author,publisher) values(d,c,1,p_data->>'checksum',p_data->>'author',p_data->>'publisher');
  return jsonb_build_object('id',d,'bucket','competition-sources','path',p_sponsor::text||'/'||c::text||'/'||d::text);
 end if;
 d:=(p_data->>'document_id')::uuid;
 select s.* into source from public.source_documents s join quizbox_competition.documents x on x.id=s.id where x.id=d and x.competition_id=c;
 if source.id is null then raise exception 'SOURCE_ACCESS_DENIED' using errcode='42501'; end if;
 if source.market_id is not null and not quizbox_market.market_allowed(source.market_id) then raise exception 'SOURCE_MARKET_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='source_detail' then
  return jsonb_build_object('id',d,'bucket',source.storage_bucket,'path',source.storage_path,'mime_type',source.mime_type,'checksum',source.checksum,'chunks',coalesce((select jsonb_agg(to_jsonb(x) order by position) from quizbox_competition.chunks x where document_id=d),'[]'));
 elsif p_action='fail_upload' then
  update quizbox_competition.documents set ingestion_status='FAILED',error_code='SOURCE_UPLOAD_FAILED',updated_at=now() where id=d and ingestion_status='UPLOADED';
  get diagnostics changed=row_count; if changed<>1 then raise exception 'UPLOAD_STATE_MISMATCH'; end if;
  return jsonb_build_object('failed',true);
 elsif p_action='retry_upload' then
  update quizbox_competition.documents set ingestion_status='UPLOADED',error_code=null,updated_at=now() where id=d and ingestion_status='FAILED' and error_code='SOURCE_UPLOAD_FAILED';
  get diagnostics changed=row_count; if changed<>1 then raise exception 'UPLOAD_NOT_RETRYABLE'; end if;
  return jsonb_build_object('id',d,'bucket',source.storage_bucket,'path',source.storage_path);
 elsif p_action='claim_extraction' then
  token:=gen_random_uuid();
  update quizbox_competition.documents set ingestion_status='PROCESSING',extraction_token=token,extraction_started_at=now(),error_code=null,updated_at=now()
  where id=d and (ingestion_status in ('UPLOADED','FAILED') or ingestion_status='PROCESSING' and extraction_started_at<now()-interval '10 minutes') returning id into s;
  if s is null then raise exception 'EXTRACTION_NOT_CLAIMABLE'; end if;
  return jsonb_build_object('token',token);
 elsif p_action='fail_extraction' then
  update quizbox_competition.documents set ingestion_status='FAILED',error_code='SOURCE_EXTRACTION_FAILED',extraction_token=null,updated_at=now() where id=d and extraction_token=(p_data->>'token')::uuid and ingestion_status='PROCESSING';
  get diagnostics changed=row_count; if changed<>1 then raise exception 'EXTRACTION_CLAIM_MISMATCH'; end if;
  return jsonb_build_object('failed',true);
 elsif p_action='finish_extraction' then
  perform 1 from quizbox_competition.documents where id=d and extraction_token=(p_data->>'token')::uuid and ingestion_status='PROCESSING' for update;
  if not found then raise exception 'EXTRACTION_CLAIM_MISMATCH'; end if;
  if jsonb_typeof(p_data->'chunks')<>'array' or jsonb_array_length(p_data->'chunks') not between 1 and 300 or exists(select 1 from jsonb_array_elements(p_data->'chunks') x where nullif(btrim(x->>'text'),'') is null or length(x->>'text')>4000 or x->>'documentId'<>d::text or (x->>'checksum') !~ '^[0-9a-f]{64}$') then raise exception 'INVALID_SOURCE_CHUNKS'; end if;
  insert into quizbox_competition.chunks(id,document_id,position,source_text,page,chapter,section,heading,checksum)
  select (x->>'id')::uuid,d,(x->>'order')::integer,x->>'text',(x->>'page')::integer,x->>'chapter',x->>'section',x->>'heading',x->>'checksum' from jsonb_array_elements(p_data->'chunks') x;
  update public.source_documents set content_text=(select string_agg(source_text,E'\\n\\n' order by position) from quizbox_competition.chunks where document_id=d),status='EXTRACTED',updated_at=now() where id=d;
  update quizbox_competition.documents set ingestion_status='READY_FOR_GENERATION',extraction_token=null,updated_at=now() where id=d;
  return jsonb_build_object('extracted',true,'approval_status','review');
 end if;
 raise exception 'UNKNOWN_SPONSOR_ACTION';
end $function$
;

-- FUNCTION quizbox_competition.dispatch_delivery
CREATE OR REPLACE FUNCTION quizbox_competition.dispatch_delivery(p_action text, p_sponsor uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x quizbox_competition.candidates; d quizbox_competition.drafts; w public.sme_review_assignments; e public.sme_review_events;
 c uuid; cfg jsonb; result jsonb; state text; kind text; reviewer uuid; policy uuid; src public.source_documents;
 qid uuid; vid uuid; aid uuid; sid uuid; payload jsonb; ctx uuid; n public.curriculum_nodes; grade public.qb_grade; tier text;
 snap quizbox_competition.snapshots; reg quizbox_competition.registrations; participant public.profiles; learner public.student_profiles;
 market uuid; registration_eligible boolean; reasons jsonb; score_result jsonb; r public.assessment_results;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>1500000 then raise exception 'INVALID_SPONSOR_INPUT'; end if;
 if p_action='review_queue' then
  return coalesce((select jsonb_agg(jsonb_build_object('candidate_id',a.id,'competition_id',a.competition_id,'assignment_id',work.id,'status',a.status,'review_kind',work.review_kind))
   from quizbox_competition.candidates a join public.sme_review_assignments work on work.candidate_id=a.id where work.reviewer_id=auth.uid() and work.review_completed_at is null
   and quizbox_competition.candidate_domain(work.domain_assignment_id,a.id,auth.uid(),work.review_kind='senior',false)),'[]');
 end if;
 if p_action in ('review_detail','complete_review') then
  select * into x from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid for update;
  select * into w from public.sme_review_assignments where id=(p_data->>'assignment_id')::uuid and candidate_id=x.id and reviewer_id=auth.uid() for update;
  if w.id is null then return quizbox_competition.dispatch_review_bridge(p_action,p_sponsor,p_data); end if;
  if not quizbox_competition.candidate_domain(w.domain_assignment_id,x.id,auth.uid(),w.review_kind='senior',p_action='complete_review' and p_data->>'decision'='approve') then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
  if p_action='review_detail' then
   if w.review_started_at is null then update public.sme_review_assignments set review_started_at=now() where id=w.id returning * into w; end if;
   return jsonb_build_object('candidate_id',x.id,'assignment',to_jsonb(w),'question',x.payload||jsonb_build_object('id',x.id,'question_text',x.payload->>'stem','option_a',x.payload#>>'{options,0}','option_b',x.payload#>>'{options,1}','option_c',x.payload#>>'{options,2}','option_d',x.payload#>>'{options,3}','correct_answer',substr('ABCD',(x.payload->>'correctAnswer')::integer+1,1),'version',x.review_revision),'validation_errors',quizbox_competition.candidate_errors(x.payload));
  end if;
  if w.review_completed_at is not null then
   select * into e from public.sme_review_events where assignment_id=w.id;
   if e.decision is distinct from p_data->>'decision' then raise exception 'REVIEW_REPLAY_MISMATCH'; end if; return to_jsonb(e);
  end if;
  if p_data->>'decision' not in ('approve','revision','reject') or (p_data->>'human_reviewed')::boolean is distinct from true or length(btrim(coalesce(p_data->>'note',''))) not between 3 and 1000 or w.review_started_at is null
  or w.question_version<>x.review_revision or (p_data->>'version')::integer is distinct from x.review_revision then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if;
  if p_data->>'decision'='approve' and quizbox_competition.candidate_errors(x.payload)<>'[]'::jsonb then raise exception 'QB_CONTENT_VALIDATION_FAILED'; end if;
  state:=case p_data->>'decision' when 'revision' then 'REVISION_REQUIRED' when 'reject' then 'REJECTED' else case when w.review_kind='primary' and quizbox_competition.senior_required(x.competition_id) then 'ASSIGNED_FOR_REVIEW' else 'APPROVED' end end;
  insert into public.sme_review_events(assignment_id,candidate_id,reviewer_id,assigned_at,review_started_at,review_completed_at,decision,review_notes,review_duration_seconds,revision_count,senior_reviewer_id,final_status,qa_reversal)
  values(w.id,x.id,auth.uid(),w.assigned_at,w.review_started_at,now(),p_data->>'decision',p_data->>'note',greatest(0,extract(epoch from now()-w.review_started_at)::integer),x.review_revision-1,case when w.review_kind='senior' then auth.uid() end,lower(state),false) returning * into e;
  update public.sme_review_assignments set review_completed_at=now() where id=w.id;
  insert into quizbox_competition.review_events(candidate_id,reviewer_id,assignment_id,decision,previous_state,new_state,notes,started_at,completed_at,policy_context_snapshot)
  values(x.id,auth.uid(),w.id,case e.decision when 'approve' then 'APPROVE' when 'reject' then 'REJECT' else 'REQUEST_REVISION' end,x.status,state,e.review_notes,e.review_started_at,e.review_completed_at,
   jsonb_build_object('policy_version_id',w.compensation_policy_version_id,'compensation_status',case when w.compensation_policy_version_id is null then 'COMPENSATION_UNRESOLVED' else 'POLICY_RESOLVED' end));
  update quizbox_competition.candidates set status=state,updated_at=now() where id=x.id;
  perform quizbox_competition.earn_review(w,e); return to_jsonb(e);
 end if;
 c:=(p_data->>'competition_id')::uuid;
 if p_action='discover' then
  return coalesce((select jsonb_agg(jsonb_build_object('competition_id',co.id,'title',co.title,'starts_at',s.payload#>>'{configuration,startsAt}','ends_at',s.payload#>>'{configuration,endsAt}','scope',s.payload#>>'{configuration,scope}'))
   from public.competitions co join quizbox_competition.snapshots s on s.competition_id=co.id where co.status='PUBLISHED'
   and (s.payload#>>'{configuration,scope}'='GLOBAL' or exists(select 1 from jsonb_array_elements_text(s.payload#>'{configuration,marketIds}') m where quizbox_market.market_allowed(m::uuid)))),'[]');
 end if;
 if p_action in ('register','start_competition','official_result','leaderboard','competition_info') then
  select * into snap from quizbox_competition.snapshots where competition_id=c order by version desc limit 1;
  if snap.id is null or not exists(select 1 from public.competitions where id=c and status='PUBLISHED') then raise exception 'COMPETITION_NOT_PUBLISHED'; end if; cfg:=snap.payload->'configuration';
  if cfg->>'scope'<>'GLOBAL' and not exists(select 1 from jsonb_array_elements_text(cfg->'marketIds') m where quizbox_market.market_allowed(m::uuid)) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='competition_info' then return jsonb_build_object('competition_id',c,'title',cfg->>'title','description',cfg->>'description','starts_at',cfg->>'startsAt','ends_at',cfg->>'endsAt','registration', (select to_jsonb(z) from quizbox_competition.registrations z where z.competition_id=c and z.participant_id=auth.uid()),'questions',cfg->'questionsPerAttempt','duration_seconds',cfg->'durationSeconds'); end if;
  if p_action='leaderboard' then
   if cfg->>'leaderboard'='hidden' or (cfg->>'leaderboard'='after_close' and now()<(cfg->>'endsAt')::timestamptz) then return '[]'; end if;
   if cfg->>'scope'<>'GLOBAL' and not exists(select 1 from jsonb_array_elements_text(cfg->'marketIds') m where quizbox_market.market_allowed(m::uuid)) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
   return coalesce((select jsonb_agg(to_jsonb(rows) order by rank,participant_id) from (select b.participant_id,b.rank,o.score,o.duration_seconds from quizbox_competition.leaderboard b join quizbox_competition.official_results o on o.id=b.result_id where b.competition_id=c order by b.rank,b.participant_id limit coalesce(nullif(cfg->>'topN','')::integer,1000)) rows),'[]');
  end if;
  select * into participant from public.profiles where id=auth.uid(); select * into learner from public.student_profiles where user_id=auth.uid() and status='active';
  if p_action='register' then
   select * into reg from quizbox_competition.registrations where competition_id=c and participant_id=auth.uid(); if reg.id is not null then return to_jsonb(reg); end if;
   market:=coalesce(nullif(p_data->>'market_id','')::uuid,participant.default_market_id); reasons:='[]';
   if learner.id is null then reasons:=reasons||'"LEARNER_PROFILE_REQUIRED"'::jsonb; end if;
   if now()<(cfg->>'registrationOpensAt')::timestamptz or now()>(cfg->>'registrationClosesAt')::timestamptz then reasons:=reasons||'"REGISTRATION_CLOSED"'::jsonb; end if;
   if cfg->>'scope'<>'GLOBAL' and (market is null or not coalesce(cfg->'marketIds' @> jsonb_build_array(market),false) or not quizbox_market.market_allowed(market)) then reasons:=reasons||'"MARKET_NOT_ELIGIBLE"'::jsonb; end if;
   if market is not null and not quizbox_market.market_allowed(market) then reasons:=reasons||'"MARKET_NOT_ELIGIBLE"'::jsonb; end if;
   if cfg->>'audience'<>'public' and upper(cfg->>'audience')<>upper(participant.role::text) then reasons:=reasons||'"AUDIENCE_NOT_ELIGIBLE"'::jsonb; end if;
   if coalesce(cfg->>'grades','')<>'' and not exists(select 1 from unnest(string_to_array(cfg->>'grades',',')) g where case btrim(g) when 'B10' then 'SHS1' else btrim(g) end=case learner.grade::text when 'B10' then 'SHS1' else learner.grade::text end) then reasons:=reasons||'"GRADE_NOT_ELIGIBLE"'::jsonb; end if;
   if coalesce(cfg->>'institutions','')<>'' and not exists(select 1 from unnest(string_to_array(cfg->>'institutions',',')) i where btrim(i)=learner.institution_id::text) then reasons:=reasons||'"INSTITUTION_NOT_ELIGIBLE"'::jsonb; end if;
   if cfg->>'access'<>'public' and not exists(select 1 from quizbox_competition.invitations where competition_id=c and participant_id=auth.uid()) then reasons:=reasons||'"INVITATION_REQUIRED"'::jsonb; end if;
   registration_eligible:=reasons='[]'::jsonb;
   insert into quizbox_competition.registrations(competition_id,snapshot_id,participant_id,market_id,institution_id,eligible,status,eligibility_snapshot)
   values(c,snap.id,auth.uid(),market,learner.institution_id,registration_eligible,case when registration_eligible then 'REGISTERED' else 'INELIGIBLE' end,jsonb_build_object('blockers',reasons,'scope',cfg->>'scope','source_mode',cfg->>'sourceMode','market_id',market,'audience',cfg->>'audience')) on conflict(competition_id,participant_id) do nothing;
   return (select to_jsonb(z) from quizbox_competition.registrations z where competition_id=c and participant_id=auth.uid());
  end if;
  select * into reg from quizbox_competition.registrations where competition_id=c and participant_id=auth.uid() for update;
  if reg.id is null or not reg.eligible then raise exception 'COMPETITION_REGISTRATION_REQUIRED' using errcode='42501'; end if;
  if reg.market_id is not null and not quizbox_market.market_allowed(reg.market_id) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='official_result' then return coalesce((select jsonb_agg(to_jsonb(o)) from quizbox_competition.official_results o where competition_id=c and participant_id=auth.uid()),'[]'); end if;
  if now()<(cfg->>'startsAt')::timestamptz or now()>=(cfg->>'endsAt')::timestamptz then raise exception 'COMPETITION_NOT_OPEN'; end if;
  result:=public.qb_start_attempt(snap.assessment_id,null,null,gen_random_uuid()::text);
  if result->>'status' is distinct from 'PASS' then raise exception '%',coalesce(result->>'message','ATTEMPT_START_FAILED'); end if; return result||jsonb_build_object('snapshot_id',snap.id,'competition_id',c);
 end if;
 if p_action='complete_competition' then
  if not exists(select 1 from quizbox_competition.participations where attempt_id=(p_data->>'attempt_id')::uuid and participant_id=auth.uid()) then raise exception 'COMPETITION_ATTEMPT_DENIED' using errcode='42501'; end if;
  result:=public.qb_complete_attempt((p_data->>'attempt_id')::uuid,'competition_submit');
  if result->>'attempt_id' is distinct from p_data->>'attempt_id' or result->>'status' not in ('submitted','expired') then raise exception '%',coalesce(result->>'message','ATTEMPT_SUBMIT_FAILED'); end if;
  return (select to_jsonb(o) from quizbox_competition.official_results o where attempt_id=(p_data->>'attempt_id')::uuid and participant_id=auth.uid());
 end if;
 if p_action='oversight' then
  if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('sponsors',coalesce((select jsonb_agg(to_jsonb(s)) from public.sponsor_profiles s),'[]'),
   'competitions',coalesce((select jsonb_agg(jsonb_build_object('competition_id',a.competition_id,'sponsor_id',a.sponsor_id,'configuration',a.configuration,'blockers',quizbox_competition.publication_blockers(a.competition_id))) from quizbox_competition.drafts a),'[]'),
   'sources',coalesce((select jsonb_agg(to_jsonb(z)-'extraction_token') from quizbox_competition.documents z),'[]'),
   'jobs',coalesce((select jsonb_agg(to_jsonb(z)-'execution_token') from quizbox_competition.generation_jobs z),'[]'),
   'candidates',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.candidates z),'[]'),
   'reviews',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.review_events z),'[]'),
   'snapshots',coalesce((select jsonb_agg(to_jsonb(z)-'payload') from quizbox_competition.snapshots z),'[]'),
   'registrations',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.registrations z),'[]'),
   'results',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.official_results z),'[]'),
   'leaderboard',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.leaderboard z),'[]'));
 end if;
 if p_action not in ('assign_candidate','revise_candidate','materialize_candidate','include_bank','publication_check','create_snapshot','publish','invite','analytics') then return quizbox_competition.dispatch_review_bridge(p_action,p_sponsor,p_data); end if;
 perform quizbox_competition.require_member(p_sponsor,p_action not in ('analytics','publication_check'));
 select * into d from quizbox_competition.drafts where competition_id=c and sponsor_id=p_sponsor for update;
 if d.competition_id is null then raise exception 'COMPETITION_ACCESS_DENIED' using errcode='42501'; end if; cfg:=d.configuration;
 if p_action='analytics' then
  return jsonb_build_object('registrations',(select count(*) from quizbox_competition.registrations where competition_id=c and eligible),
   'attempts_started',(select count(*) from quizbox_competition.participations where competition_id=c),
   'attempts_completed',(select count(*) from quizbox_competition.official_results where competition_id=c),
   'completion_rate',coalesce((select count(*)::numeric from quizbox_competition.official_results where competition_id=c)*100/nullif((select count(*) from quizbox_competition.participations where competition_id=c),0),0),
   'average_score',(select avg(score) from quizbox_competition.official_results where competition_id=c),
   'score_distribution',coalesce((select jsonb_agg(to_jsonb(z)) from (select floor(percentage/10)*10 bucket,count(*) n from quizbox_competition.official_results where competition_id=c group by 1) z),'[]'),
   'market_distribution',coalesce((select jsonb_agg(to_jsonb(z)) from (select market_id,count(*) n from quizbox_competition.registrations where competition_id=c and eligible group by market_id) z),'[]'),
   'institution_distribution',coalesce((select jsonb_agg(to_jsonb(z)) from (select institution_id,count(*) n from quizbox_competition.registrations where competition_id=c and eligible group by institution_id) z),'[]'),
   'question_performance',coalesce((select jsonb_agg(to_jsonb(z)) from (select resp.question_id,q.difficulty_label,count(*) responses,avg(case when resp.is_correct then 100 else 0 end) accuracy from public.responses resp join quizbox_competition.official_results o on o.attempt_id=resp.attempt_id join public.questions q on q.id=resp.question_id where o.competition_id=c group by resp.question_id,q.difficulty_label) z),'[]'),
   'ranking_summary',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.leaderboard z where competition_id=c),'[]'));
 end if;
 if p_action='publication_check' then return jsonb_build_object('blockers',quizbox_competition.publication_blockers(c)); end if;
 if p_action='publish' then
  reasons:=quizbox_competition.publication_blockers(c); if reasons<>'[]'::jsonb then return jsonb_build_object('published',false,'blockers',reasons); end if;
  update public.competitions set status='PUBLISHED',updated_at=now() where id=c;
  return jsonb_build_object('published',true,'blockers','[]'::jsonb);
 end if;
 if p_action='invite' then
  insert into quizbox_competition.invitations(competition_id,participant_id,invited_by) values(c,(p_data->>'participant_id')::uuid,auth.uid()) on conflict do nothing; return jsonb_build_object('saved',true);
 end if;
 if p_action='create_snapshot' then
  select * into snap from quizbox_competition.snapshots where competition_id=c;
  if snap.id is not null then return jsonb_build_object('snapshot_id',snap.id,'assessment_id',snap.assessment_id); end if;
  reasons:=quizbox_competition.publication_blockers(c,false); if reasons<>'[]'::jsonb then return jsonb_build_object('blockers',reasons); end if;
  ctx:=public.qb_create_content_context(cfg->>'scope',cfg->>'sourceMode',array(select v::uuid from jsonb_array_elements_text(cfg->'marketIds') v),array(select v::uuid from jsonb_array_elements_text(cfg->'sourceIds') v));
  select jsonb_agg(jsonb_build_object('version_id',v.id,'question_id',v.question_id,'content',v.snapshot) order by b.position) into payload from quizbox_competition.bank_items b join public.question_versions v on v.id=b.question_version_id where b.competition_id=c and b.included;
  if cfg->>'sourceMode'='CURRICULUM_ALIGNED' then select q.grade into grade from quizbox_competition.bank_items b join public.question_versions v on v.id=b.question_version_id join public.questions q on q.id=v.question_id where b.competition_id=c and b.included limit 1; end if;
  insert into public.assessments(assessment_type,owner_role,owner_user_id,subject_code,subject_name,grade,question_count,time_limit_minutes,max_attempts,pass_percent,opens_at,expires_at,tenant_id,reference_type,reference_id,source_mode)
  values('COMPETITION','sponsor',auth.uid(),'COMPETITION',cfg->>'title',grade,(cfg->>'totalQuestions')::integer,ceil((cfg->>'durationSeconds')::numeric/60),(cfg->>'attemptLimit')::integer,coalesce(nullif(cfg->>'passMark','')::numeric,50),(cfg->>'startsAt')::timestamptz,(cfg->>'endsAt')::timestamptz,public.qb_public_tenant_id(),'COMPETITION',c,cfg->>'sourceMode') returning id into aid;
  update public.competitions set assessment_id=aid,content_context_id=ctx where id=c;
  update quizbox_competition.drafts set content_context_id=ctx where competition_id=c;
  insert into public.assessment_questions(assessment_id,question_id,question_order,question_text_snapshot,option_a_snapshot,option_b_snapshot,option_c_snapshot,option_d_snapshot,correct_answer_snapshot,marks_snapshot,answer_type_snapshot,answer_spec_snapshot,question_content_snapshot,source_type_snapshot,question_version_snapshot,editorial_approved_snapshot)
  select aid,(v->>'question_id')::uuid,row_number() over(),v#>>'{content,question_text}',v#>>'{content,option_a}',v#>>'{content,option_b}',v#>>'{content,option_c}',v#>>'{content,option_d}',v#>>'{content,correct_answer}',(v#>>'{content,marks}')::numeric,v#>>'{content,answer_type}',v#>'{content,answer_spec}',v#>'{content,question_content}',v#>>'{content,source_type}',(v#>>'{content,version}')::integer,true from jsonb_array_elements(payload) v;
  payload:=jsonb_build_object('competition_id',c,'version',1,'configuration',cfg,'questions',payload,'source_context',(select to_jsonb(z) from public.content_contexts z where id=ctx),'created_at',now(),'created_by',auth.uid());
  insert into quizbox_competition.snapshots(competition_id,version,payload,checksum,published_by,assessment_id) values(c,1,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),auth.uid(),aid) returning id into sid;
  update public.assessments set competition_snapshot_id=sid where id=aid;
  return jsonb_build_object('snapshot_id',sid,'assessment_id',aid,'blockers','[]'::jsonb);
 end if;
 select * into x from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid and competition_id=c for update;
 if x.id is null then raise exception 'CANDIDATE_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='materialize_candidate' then
  if x.question_id is not null then return jsonb_build_object('question_id',x.question_id,'version_id',x.approved_version_id,'idempotent',true); end if;
  if x.status<>'APPROVED' or not quizbox_competition.source_valid(x.id) then raise exception 'CANDIDATE_NOT_APPROVED'; end if;
  select * into e from public.sme_review_events where assignment_id=case when quizbox_competition.senior_required(c) then x.senior_assignment_id else x.primary_assignment_id end and decision='approve';
  if e.id is null then raise exception 'REVIEW_INCOMPLETE'; end if;
  select * into n from public.curriculum_nodes where id=nullif(x.payload->>'curriculumNodeId','')::uuid;
  insert into public.questions(external_question_id,question_code,subject_code,subject_name,grade,source_grade_code,canonical_grade_code,curriculum_id,curriculum_node_id,question_text,option_a,option_b,option_c,option_d,correct_answer,answer_type,answer_spec,explanation,difficulty_label,difficulty_code,cognitive_level,marks,estimated_time_seconds,source_type,status,validation_status,reviewed_by,reviewed_at,editorial_metadata,source_document_ids,content_origin,origin_candidate_id,origin_metadata)
  values('sponsor-candidate:'||x.id,'sponsor-candidate:'||x.id,x.payload->>'subject',x.payload->>'subject',coalesce(n.source_grade_code,n.grade_code)::public.qb_grade,n.source_grade_code,n.canonical_grade_code,x.curriculum_id,n.id,x.payload->>'stem',x.payload#>>'{options,0}',x.payload#>>'{options,1}',coalesce(x.payload#>>'{options,2}',''),coalesce(x.payload#>>'{options,3}',''),substr('ABCD',(x.payload->>'correctAnswer')::integer+1,1),case when jsonb_array_length(x.payload->'options')=2 then 'TRUE_FALSE' else 'SINGLE_CHOICE' end,
  case when jsonb_array_length(x.payload->'options')=2 then jsonb_build_object('boolean',(x.payload->>'correctAnswer')::integer=0) else '{}'::jsonb end,x.payload->>'explanation',x.payload->>'difficulty',x.payload->>'difficulty',x.payload->>'cognitiveLevel',1,60,'AI_GENERATED','active','approved',e.reviewer_id,e.review_completed_at,jsonb_build_object('human_reviewed',true,'review_event_id',e.id),
  array(select v::uuid from jsonb_array_elements_text(cfg->'sourceIds') v),case cfg->>'sourceMode' when 'SPONSOR_SOURCE' then 'SPONSOR_DOCUMENT' when 'HYBRID' then 'HYBRID' else 'CURRICULUM' end,x.id,
  jsonb_build_object('competition_id',c,'sponsor_id',p_sponsor,'market_scope',cfg->>'scope','market_ids',cfg->'marketIds','source_mode',cfg->>'sourceMode','source_document_id',x.source_document_id,'source_chunk_id',x.source_chunk_id,'generation_job_id',x.job_id,'candidate_id',x.id,'education_level',x.payload->>'educationLevel','created_by',auth.uid(),'approved_by',e.reviewer_id,'review_event_id',e.id)) returning id into qid;
  select id into vid from public.question_versions where question_id=qid and version_no=1;
  if vid is null then raise exception 'QUESTION_VERSION_CAPTURE_REQUIRED'; end if;
  update quizbox_competition.candidates set question_id=qid,approved_version_id=vid where id=x.id;
  return jsonb_build_object('question_id',qid,'version_id',vid);
 end if;
 if exists(select 1 from quizbox_competition.snapshots where competition_id=c) then raise exception 'COMPETITION_FROZEN'; end if;
 if p_action='include_bank' then
  if x.question_id is null then perform quizbox_competition.dispatch('materialize_candidate',p_sponsor,p_data); end if;
  return quizbox_competition.dispatch_review_bridge(p_action,p_sponsor,p_data);
 elsif p_action='assign_candidate' then
  kind:=coalesce(p_data->>'kind','primary'); reviewer:=(p_data->>'reviewer_id')::uuid;
  if kind not in ('primary','senior') or x.question_id is not null then raise exception 'INVALID_CANDIDATE_REVIEW'; end if;
  if not quizbox_competition.candidate_domain((p_data->>'domain_id')::uuid,x.id,reviewer,kind='senior',false) then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
  if kind='senior' and (not exists(select 1 from public.sme_review_events where assignment_id=x.primary_assignment_id and decision='approve') or exists(select 1 from public.sme_review_assignments where id=x.primary_assignment_id and reviewer_id=reviewer)) then raise exception 'INDEPENDENT_PRIMARY_REVIEW_REQUIRED'; end if;
  select * into w from public.sme_review_assignments where candidate_id=x.id and question_version=x.review_revision and review_kind=kind and reviewer_id=reviewer;
  if w.id is not null then return to_jsonb(w); end if;
  if x.status not in ('GENERATED','ASSIGNED_FOR_REVIEW') or (kind='primary' and x.primary_assignment_id is not null) or (kind='senior' and x.senior_assignment_id is not null) then raise exception 'CANDIDATE_ALREADY_REVIEWED'; end if;
  select reviewer_tier into tier from public.sme_profiles where user_id=reviewer; select * into src from public.source_documents where id=x.source_document_id;
  policy:=quizbox_sme.resolve_policy(src.market_id,null,p_sponsor,tier,x.payload->>'subject',x.payload->>'educationLevel',now());
  insert into public.sme_review_assignments(candidate_id,question_version,reviewer_id,domain_assignment_id,market_id,sponsor_id,compensation_policy_version_id,review_kind,assigned_by)
  values(x.id,x.review_revision,reviewer,(p_data->>'domain_id')::uuid,src.market_id,p_sponsor,policy,kind,auth.uid()) returning * into w;
  update quizbox_competition.candidates set status='ASSIGNED_FOR_REVIEW',primary_assignment_id=case when kind='primary' then w.id else primary_assignment_id end,senior_assignment_id=case when kind='senior' then w.id else senior_assignment_id end where id=x.id; return to_jsonb(w);
 elsif p_action='revise_candidate' then
  if x.status<>'REVISION_REQUIRED' or x.question_id is not null or exists(select 1 from public.sme_review_assignments where candidate_id=x.id and review_completed_at is null) then raise exception 'CANDIDATE_NOT_REVISION_READY'; end if;
  if exists(select 1 from jsonb_object_keys(p_data->'patch') k where k not in ('stem','options','correctAnswer','explanation','difficulty','cognitiveLevel')) or quizbox_competition.candidate_errors(x.payload||p_data->'patch')<>'[]'::jsonb then raise exception 'INVALID_CANDIDATE_REVISION'; end if;
  update quizbox_competition.candidates set payload=payload||p_data->'patch',review_revision=review_revision+1,status='GENERATED',primary_assignment_id=null,senior_assignment_id=null where id=x.id; return jsonb_build_object('saved',true);
 end if;
 raise exception 'INVALID_SPONSOR_ACTION';
end $function$
;

-- FUNCTION quizbox_competition.dispatch_review_bridge
CREATE OR REPLACE FUNCTION quizbox_competition.dispatch_review_bridge(p_action text, p_sponsor uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c uuid; item quizbox_competition.candidates; work public.sme_review_assignments; q public.questions;
 draft quizbox_competition.drafts; job quizbox_competition.generation_jobs; result jsonb; role_name text; kind text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>1500000 then raise exception 'INVALID_SPONSOR_INPUT'; end if;
 if p_action='review_queue' then
  return coalesce((select jsonb_agg(jsonb_build_object('candidate_id',x.id,'competition_id',x.competition_id,'assignment_id',w.id,'status',x.status,'review_kind',w.review_kind))
  from quizbox_competition.candidates x join public.sme_review_assignments w on w.id in (x.primary_assignment_id,x.senior_assignment_id)
  where w.reviewer_id=auth.uid() and w.review_completed_at is null
  and quizbox_sme.domain_matches(w.domain_assignment_id,w.question_id,auth.uid(),w.market_id,w.review_kind='senior',false)),'[]');
 end if;
 if p_action in ('review_detail','complete_review') then
  select * into item from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid for update;
  select * into work from public.sme_review_assignments where id=(p_data->>'assignment_id')::uuid and id in(item.primary_assignment_id,item.senior_assignment_id) and reviewer_id=auth.uid();
  if work.id is null then raise exception 'QB_REVIEW_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='review_detail' then
   result:=public.qb_sme_review_detail(work.id);
   if work.review_completed_at is null then update quizbox_competition.candidates set status='UNDER_REVIEW',updated_at=now() where id=item.id; end if;
   return result||jsonb_build_object('candidate_id',item.id);
  end if;
  return public.qb_sme_complete_review(work.id,p_data->>'decision',p_data->>'note',(p_data->>'human_reviewed')::boolean,(p_data->>'version')::integer);
 end if;
 if p_action='oversight' then
  if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('competition_id',competition_id,'status',status,'count',n)) from
   (select competition_id,status,count(*) n from quizbox_competition.candidates group by competition_id,status) x),'[]'),
   'unresolved_compensation',coalesce((select jsonb_agg(to_jsonb(e)) from quizbox_competition.review_events e where e.policy_context_snapshot->>'compensation_status'='COMPENSATION_UNRESOLVED'),'[]'),
   'extraction_failures',coalesce((select jsonb_agg(to_jsonb(d)-'extraction_token') from quizbox_competition.documents d where ingestion_status='FAILED'),'[]'));
 end if;
 if p_action not in ('candidates','assign_candidate','bank','include_bank','retry_generation','claim_generation','fail_generation','finish_generation') then
  return quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data);
 end if;
 role_name:=quizbox_competition.require_member(p_sponsor,p_action not in ('candidates','bank'));
 c:=(p_data->>'competition_id')::uuid;
 select * into draft from quizbox_competition.drafts where competition_id=c and sponsor_id=p_sponsor for update;
 if draft.competition_id is null then raise exception 'COMPETITION_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='candidates' then return coalesce((select jsonb_agg(to_jsonb(x)) from quizbox_competition.candidates x where competition_id=c),'[]'); end if;
 if p_action='bank' then return coalesce((select jsonb_agg(to_jsonb(x) order by position) from quizbox_competition.bank_items x where competition_id=c),'[]'); end if;
 if exists(select 1 from quizbox_competition.snapshots where competition_id=c) then raise exception 'COMPETITION_FROZEN'; end if;
 if p_action='retry_generation' then
  select * into job from quizbox_competition.generation_jobs where id=(p_data->>'job_id')::uuid and competition_id=c for update;
  if job.id is null or not (job.status='FAILED' or (job.status='PROCESSING' and job.started_at<now()-interval '10 minutes')) or job.execution_count>=3 or exists(select 1 from quizbox_competition.candidates where job_id=job.id) then raise exception 'GENERATION_NOT_RETRYABLE'; end if;
  update quizbox_competition.generation_jobs set status='QUEUED',execution_token=null,started_at=null,completed_at=null,error_code=null where id=job.id;
  return jsonb_build_object('id',job.id,'status','QUEUED');
 elsif p_action='claim_generation' then
  result:=quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data);
  update quizbox_competition.generation_jobs set execution_count=execution_count+1 where id=(p_data->>'job_id')::uuid and competition_id=c;
  return result;
 elsif p_action='fail_generation' then
  result:=quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data);
  update quizbox_competition.generation_jobs set error_code=case when p_data->>'error_code' ~ '^[A-Z][A-Z0-9_]{2,100}$' then p_data->>'error_code' else 'GENERATION_FAILED' end where id=(p_data->>'job_id')::uuid and competition_id=c;
  return result;
 elsif p_action='finish_generation' then
  result:=quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data);
  if result->>'status'='FAILED' then update quizbox_competition.generation_jobs set error_code='EMPTY_GENERATION_OUTPUT' where id=(p_data->>'job_id')::uuid and competition_id=c; end if;
  return result;
 end if;
 select * into item from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid and competition_id=c for update;
 if item.id is null then raise exception 'CANDIDATE_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='assign_candidate' then
  if not quizbox_sme.has_capability('content_admin') then raise exception 'QB_SME_ASSIGNMENT_DENIED' using errcode='42501'; end if;
  kind:=coalesce(p_data->>'kind','primary');
  if kind not in ('primary','senior') then raise exception 'QB_INVALID_REVIEW_KIND'; end if;
  if kind='primary' and item.primary_assignment_id is not null then
   select * into work from public.sme_review_assignments where id=item.primary_assignment_id;
   if work.reviewer_id is distinct from (p_data->>'reviewer_id')::uuid then raise exception 'REVIEW_ASSIGNMENT_CONFLICT'; end if;
   if not quizbox_sme.domain_matches(work.domain_assignment_id,work.question_id,work.reviewer_id,work.market_id,false,false) then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
   return to_jsonb(work);
  end if;
  if kind='senior' and (item.senior_assignment_id is not null or not exists(select 1 from public.sme_review_events where assignment_id=item.primary_assignment_id and decision='approve')) then raise exception 'PRIMARY_REVIEW_REQUIRED'; end if;
  -- Materialization stays with the established content importer. Never invent a
  -- national indicator for document-only candidates to make SME validation pass.
  select * into q from public.questions where id=coalesce(item.question_id,(p_data->>'question_id')::uuid);
  if q.id is null then raise exception 'CANDIDATE_QUESTION_MAPPING_REQUIRED'; end if;
  if q.curriculum_id is distinct from item.curriculum_id or q.question_text is distinct from item.payload->>'stem'
   or q.explanation is distinct from item.payload->>'explanation' or q.subject_code is distinct from item.payload->>'subject'
   or q.option_a is distinct from item.payload#>>'{options,0}' or q.option_b is distinct from item.payload#>>'{options,1}'
   or coalesce(q.option_c,'') is distinct from coalesce(item.payload#>>'{options,2}','') or coalesce(q.option_d,'') is distinct from coalesce(item.payload#>>'{options,3}','')
   or q.correct_answer is distinct from substr('ABCD',(item.payload->>'correctAnswer')::integer+1,1)
   or not (q.source_document_ids @> array[item.source_document_id]) then raise exception 'CANDIDATE_QUESTION_IDENTITY_MISMATCH'; end if;
  result:=public.qb_sme_assign_review(q.id,(p_data->>'reviewer_id')::uuid,(p_data->>'domain_id')::uuid,kind,p_sponsor,
   case when kind='senior' then (select id from public.sme_review_events where assignment_id=item.primary_assignment_id) end);
  update quizbox_competition.candidates set question_id=q.id,status='ASSIGNED_FOR_REVIEW',primary_assignment_id=case when kind='primary' then (result->>'id')::uuid else primary_assignment_id end,
  senior_assignment_id=case when kind='senior' then (result->>'id')::uuid else senior_assignment_id end,updated_at=now() where id=item.id;
  -- The original SME policy resolver pins the exact version at assignment.
  return result;
 elsif p_action='include_bank' then
  if coalesce((p_data->>'included')::boolean,true) then
   if coalesce((draft.configuration->>'totalQuestions')::integer,0) not between 1 and 500 then raise exception 'INVALID_BANK_TARGET'; end if;
   perform quizbox_market.validate_context(draft.configuration->>'scope',draft.configuration->>'sourceMode',
    array(select x::uuid from jsonb_array_elements_text(draft.configuration->'marketIds') x),
    array(select x::uuid from jsonb_array_elements_text(draft.configuration->'sourceIds') x));
   if item.status<>'APPROVED' or item.approved_version_id is null or not exists(select 1 from public.questions bank_question join public.question_versions v on v.question_id=bank_question.id and v.version_no=bank_question.version where bank_question.id=item.question_id and bank_question.validation_status='approved' and v.id=item.approved_version_id)
   or exists(select 1 from public.sme_review_assignments where id in(item.primary_assignment_id,item.senior_assignment_id) and review_completed_at is null)
   or not coalesce(draft.configuration->'sourceIds' @> jsonb_build_array(item.source_document_id),false)
   or not exists(select 1 from public.source_documents where id=item.source_document_id and validation_status='approved' and rights_confirmed) then raise exception 'UNAPPROVED_BANK_OR_PROVENANCE'; end if;
   if (select count(*) from quizbox_competition.bank_items where competition_id=c and included and candidate_id<>item.id)>=(draft.configuration->>'totalQuestions')::integer then raise exception 'BANK_TARGET_COUNT_EXCEEDED'; end if;
   insert into quizbox_competition.bank_items(competition_id,candidate_id,question_version_id,position,included)
   values(c,item.id,item.approved_version_id,(p_data->>'position')::integer,true)
   on conflict(competition_id,candidate_id) do update set included=true,question_version_id=excluded.question_version_id,position=excluded.position;
  else update quizbox_competition.bank_items set included=false where competition_id=c and candidate_id=item.id; end if;
  return jsonb_build_object('saved',true);
 end if;
 raise exception 'INVALID_SPONSOR_ACTION';
end $function$
;

-- FUNCTION quizbox_competition.dispatch_review_ops
CREATE OR REPLACE FUNCTION quizbox_competition.dispatch_review_ops(p_action text, p_sponsor uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x quizbox_competition.candidates; result jsonb; senior boolean;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'INVALID_SPONSOR_INPUT'; end if;
 if p_action in ('assign_candidate','assignment_queue','eligible_reviewers') and not quizbox_sme.has_capability('content_admin') then
  raise exception 'QB_SME_ASSIGNMENT_DENIED' using errcode='42501';
 end if;

 if p_action='assignment_queue' then
  return coalesce((select jsonb_agg(z.row order by z.created_at) from (
   select k.created_at,jsonb_build_object('candidate_id',k.id,'competition_id',k.competition_id,'sponsor_id',d.sponsor_id,
    'sponsor_name',sp.organization_name,'competition_title',d.configuration->>'title','market_id',src.market_id,'market_name',m.name,
    'subject',k.payload->>'subject','difficulty',k.payload->>'difficulty','stem',k.payload->>'stem','status',k.status,
    'primary_assigned',k.primary_assignment_id is not null,'senior_assigned',k.senior_assignment_id is not null,
    'senior_required',quizbox_competition.senior_required(k.competition_id),
    'primary_approved',exists(select 1 from public.sme_review_events e where e.assignment_id=k.primary_assignment_id and e.decision='approve'),
    'primary_reviewer',(select quizbox_competition.participant_label(w.reviewer_id,0) from public.sme_review_assignments w where w.id=k.primary_assignment_id),
    'senior_reviewer',(select quizbox_competition.participant_label(w.reviewer_id,0) from public.sme_review_assignments w where w.id=k.senior_assignment_id)) row
   from quizbox_competition.candidates k join quizbox_competition.drafts d on d.competition_id=k.competition_id
   join public.source_documents src on src.id=k.source_document_id left join public.markets m on m.id=src.market_id
   left join public.sponsor_profiles sp on sp.id=d.sponsor_id
   where k.question_id is null and k.status in ('GENERATED','ASSIGNED_FOR_REVIEW','UNDER_REVIEW','REVISION_REQUIRED','APPROVED')
    and (src.market_id is null or quizbox_market.market_allowed(src.market_id))
    and (nullif(p_data->>'market_id','') is null or src.market_id=(p_data->>'market_id')::uuid)
    and (nullif(p_data->>'subject','') is null or k.payload->>'subject'=p_data->>'subject')
    and (nullif(p_data->>'status','') is null or k.status=p_data->>'status')
   order by k.created_at limit 200) z),'[]');
 end if;

 if p_action='eligible_reviewers' then
  select * into x from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid;
  if x.id is null then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  senior:=coalesce(p_data->>'kind','primary')='senior';
  return coalesce((select jsonb_agg(jsonb_build_object('reviewer_id',dom.reviewer_id,'domain_id',dom.id,
    'reviewer_name',coalesce(nullif(btrim(p.full_name),''),'Reviewer'),'subject',dom.subject_code,'tier',sp.reviewer_tier,
    'can_approve',dom.can_approve,'open_reviews',(select count(*) from public.sme_review_assignments w where w.reviewer_id=dom.reviewer_id and w.review_completed_at is null))
    order by p.full_name)
   from public.sme_domain_assignments dom join public.sme_profiles sp on sp.user_id=dom.reviewer_id join public.profiles p on p.id=dom.reviewer_id
   where quizbox_competition.candidate_domain(dom.id,x.id,dom.reviewer_id,senior,false)
    and (not senior or not exists(select 1 from public.sme_review_assignments w where w.id=x.primary_assignment_id and w.reviewer_id=dom.reviewer_id))),'[]');
 end if;

 if p_action='review_detail' then
  result:=quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data);
  -- Only the authorized reviewer reaches this point; add the cited excerpt from the candidate's own chunk.
  return result||coalesce((select jsonb_build_object('source',jsonb_build_object('document_title',sd.title,'excerpt',ch.source_text,
    'page',ch.page,'chapter',ch.chapter,'section',ch.section,'heading',ch.heading,'document_id',sd.id,'chunk_id',ch.id))
   from quizbox_competition.candidates c join quizbox_competition.chunks ch on ch.id=c.source_chunk_id and ch.document_id=c.source_document_id
   join public.source_documents sd on sd.id=c.source_document_id where c.id=(result->>'candidate_id')::uuid),'{}');
 end if;

 if p_action='leaderboard' then
  result:=quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data);
  return coalesce((select jsonb_agg((e-'participant_id')||jsonb_build_object('display_name',quizbox_competition.participant_label((e->>'participant_id')::uuid,(e->>'rank')::integer),
    'is_you',(e->>'participant_id')::uuid=auth.uid())) from jsonb_array_elements(result) e),'[]');
 end if;

 if p_action='analytics' then
  result:=quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data);
  return jsonb_set(result,'{ranking_summary}',coalesce((select jsonb_agg(jsonb_build_object('rank',(e->>'rank')::integer,
    'display_name',quizbox_competition.participant_label((e->>'participant_id')::uuid,(e->>'rank')::integer),
    'score',r.score,'possible_score',r.possible_score,'duration_seconds',r.duration_seconds) order by (e->>'rank')::integer)
   from jsonb_array_elements(result->'ranking_summary') e left join quizbox_competition.official_results r on r.id=(e->>'result_id')::uuid),'[]'));
 end if;

 return quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data);
end $function$
;

-- FUNCTION quizbox_competition.engine_attempt_review
CREATE OR REPLACE FUNCTION quizbox_competition.engine_attempt_review(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_attempt public.attempts%rowtype;
    v_student_id uuid;
    v_questions jsonb;

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


    if v_attempt.submitted_at is null then
        raise exception
            'QB_REVIEW_NOT_AVAILABLE_BEFORE_SUBMISSION';
    end if;


    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'question_order',aq.question_order,
                'question_id',aq.question_id,
                'question_text',aq.question_text_snapshot,
                'question_content',aq.question_content_snapshot,
                'options',aq.options_snapshot,
                'media',aq.media_snapshot,

                'selected_answer',r.selected_answer,
                'selected_value',r.selected_value,

                'correct_answer',aq.correct_answer_snapshot,
                'answer_spec',aq.answer_spec_snapshot,

                'is_correct',r.is_correct,
                'marks_awarded',r.marks_awarded,
                'marks',aq.marks_snapshot
            )
            order by aq.question_order
        ),
        '[]'::jsonb
    )

    into v_questions

    from public.assessment_questions aq

    left join public.responses r
      on r.attempt_id = p_attempt_id
     and r.question_id = aq.question_id

    where aq.assessment_id =
        v_attempt.assessment_id;


    return jsonb_build_object(
        'status','PASS',

        'attempt_id',
            p_attempt_id,

        'result',
            public.qb_get_result(
                p_attempt_id
            ),

        'questions',
            v_questions
    );

end;
$function$
;

-- FUNCTION quizbox_private.core_qb_complete_attempt
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
end $function$
;

-- FUNCTION quizbox_private.core_qb_content_ingest
CREATE OR REPLACE FUNCTION quizbox_private.core_qb_content_ingest(p_spec jsonb, p_candidates jsonb, p_source_file text DEFAULT 'candidate.json'::text, p_provider text DEFAULT 'human'::text, p_model text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare batch public.content_import_batches; candidate jsonb; errors jsonb; n public.curriculum_nodes; inserted public.questions; digest text; idx integer:=0; valid integer:=0; rejected integer:=0; dup text; source text;
begin p_spec:=quizbox_market.generation_context(p_spec);
 
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

-- FUNCTION quizbox_private.core_qb_content_request_generation
CREATE OR REPLACE FUNCTION quizbox_private.core_qb_content_request_generation(p_spec jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.curriculum_nodes; batch uuid; hash text;
begin p_spec:=quizbox_market.generation_context(p_spec);
 
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

-- FUNCTION quizbox_private.core_qb_content_review
CREATE OR REPLACE FUNCTION quizbox_private.core_qb_content_review(p_id uuid, p_action text, p_version integer, p_expected_state text, p_patch jsonb DEFAULT '{}'::jsonb, p_note text DEFAULT ''::text, p_human_reviewed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.questions; errors jsonb; target text;
begin perform quizbox_market.assert_question(p_id);
 
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

-- FUNCTION quizbox_private.core_qb_save_practice_response
CREATE OR REPLACE FUNCTION quizbox_private.core_qb_save_practice_response(p_attempt_id uuid, p_question_id uuid, p_selected_answer text DEFAULT NULL::text, p_selected_value jsonb DEFAULT NULL::jsonb, p_response_seconds integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.attempts; q public.assessment_questions; r public.responses; correct boolean; explain text; question_hint text;
begin
 
 select * into t from public.attempts where id=p_attempt_id for update;
 if t.id is null or auth.uid() is null or t.student_user_id is distinct from auth.uid() then raise exception 'QB_ATTEMPT_OWNERSHIP_DENIED'; end if;
 if t.status<>'in_progress' or (t.expires_at is not null and t.expires_at<=now()) then raise exception 'QB_ATTEMPT_NOT_ACTIVE'; end if;
 if public.qb_attempt_mode(p_attempt_id) is distinct from 'PRACTICE' then raise exception 'QB_PRACTICE_ONLY'; end if;
 if nullif(trim(p_selected_answer),'') is null and p_selected_value is null then raise exception 'QB_RESPONSE_REQUIRED'; end if;
 select * into q from public.assessment_questions where assessment_id=t.assessment_id and question_id=p_question_id;
 if not found then raise exception 'QB_QUESTION_NOT_IN_ATTEMPT'; end if;
 perform quizbox_private.core_qb_save_response(p_attempt_id,p_question_id,p_selected_answer,p_selected_value,p_response_seconds);
 select * into r from public.responses where attempt_id=p_attempt_id and question_id=p_question_id;
 correct := coalesce(public.qb_grade_response(q.answer_type_snapshot,q.correct_answer_snapshot,q.answer_spec_snapshot,r.selected_answer,r.selected_value),false);
 update public.responses set is_correct=correct,marks_awarded=case when correct then coalesce(q.marks_snapshot,1) else 0 end where id=r.id;
 select explanation,hint into explain,question_hint from public.questions where id=p_question_id;
 return jsonb_build_object('question_id',p_question_id,'is_correct',correct,'selected_answer',r.selected_answer,'selected_value',r.selected_value,
 'correct_answer',coalesce(q.correct_answer_snapshot,q.answer_spec_snapshot->>'value',q.answer_spec_snapshot->>'canonical',(q.answer_spec_snapshot->'correct_options')::text,(q.answer_spec_snapshot->'accepted')::text),
 'explanation',explain,'hint',question_hint,'marks_awarded',case when correct then coalesce(q.marks_snapshot,1) else 0 end);
end $function$
;

-- FUNCTION quizbox_private.core_qb_save_response
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
;

-- FUNCTION quizbox_private.core_qb_start_attempt
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
;

-- FUNCTION quizbox_private.core_qb_submit_attempt
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
;

-- TABLE public.admin_actions
create table if not exists public.admin_actions (
  id uuid default gen_random_uuid() not null,
  actor_user_id uuid,
  action_code text not null,
  target_type text,
  target_id uuid,
  reason text,
  details jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.analytics_events
create table if not exists public.analytics_events (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  user_id uuid,
  event_name text not null,
  entity_type text,
  entity_id uuid,
  session_id text,
  properties jsonb default '{}'::jsonb not null,
  occurred_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.assessment_results
create table if not exists public.assessment_results (
  id uuid default gen_random_uuid() not null,
  attempt_id uuid not null,
  assessment_id uuid not null,
  assignment_id uuid,
  class_id uuid,
  tenant_id uuid,
  student_id uuid not null,
  student_user_id uuid not null,
  subject_code text,
  grade text,
  question_count integer default 0 not null,
  answered_count integer default 0 not null,
  correct_count integer default 0 not null,
  incorrect_count integer default 0 not null,
  unanswered_count integer default 0 not null,
  score numeric(14,2) default 0 not null,
  total_marks numeric(14,2) default 0 not null,
  percentage numeric(8,2) default 0 not null,
  pass_percent numeric(8,2),
  passed boolean,
  started_at timestamp with time zone,
  submitted_at timestamp with time zone,
  submission_reason text,
  status text default 'final'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.badges
create table if not exists public.badges (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  description text,
  badge_type text,
  criteria jsonb default '{}'::jsonb not null,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.class_staff
create table if not exists public.class_staff (
  id uuid default gen_random_uuid() not null,
  class_id uuid not null,
  teacher_id uuid not null,
  role text default 'TEACHER'::text not null,
  status text default 'ACTIVE'::text not null,
  joined_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.commission_rules
create table if not exists public.commission_rules (
  id uuid default gen_random_uuid() not null,
  seller_id uuid,
  product_type text,
  platform_fee_rate numeric(8,4) default 0 not null,
  minimum_fee numeric(14,2),
  maximum_fee numeric(14,2),
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_appeals
create table if not exists public.competition_appeals (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  submitted_by uuid,
  related_entity_type text,
  related_entity_id uuid,
  reason text not null,
  status text default 'OPEN'::text not null,
  resolution text,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_institutions
create table if not exists public.competition_institutions (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  institution_id uuid not null,
  registration_status text default 'PENDING'::text not null,
  verification_status text default 'PENDING'::text not null,
  registered_at timestamp with time zone default now() not null,
  verified_at timestamp with time zone,
  PRIMARY KEY (id)
);

-- TABLE public.competition_leaderboard
create table if not exists public.competition_leaderboard (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  student_id uuid not null,
  score numeric(14,2) default 0 not null,
  percentage numeric(8,2) default 0 not null,
  completion_time_ms bigint,
  rank integer,
  tie_break_value numeric(14,4),
  calculated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_match_participants
create table if not exists public.competition_match_participants (
  id uuid default gen_random_uuid() not null,
  match_id uuid not null,
  participant_type text not null,
  participant_id uuid not null,
  seed_no integer,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_matches
create table if not exists public.competition_matches (
  id uuid default gen_random_uuid() not null,
  round_id uuid not null,
  match_no integer,
  match_type text default 'STANDARD'::text not null,
  scheduled_at timestamp with time zone,
  status text default 'PENDING'::text not null,
  winner_entity_type text,
  winner_entity_id uuid,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_officials
create table if not exists public.competition_officials (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  user_id uuid not null,
  official_role text not null,
  status text default 'ACTIVE'::text not null,
  appointed_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_participants
create table if not exists public.competition_participants (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  student_id uuid not null,
  registration_status text default 'REGISTERED'::text not null,
  payment_status text default 'NOT_REQUIRED'::text not null,
  registered_at timestamp with time zone default now() not null,
  qualified_at timestamp with time zone,
  completed_at timestamp with time zone,
  PRIMARY KEY (id)
);

-- TABLE public.competition_results
create table if not exists public.competition_results (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  stage_id uuid,
  round_id uuid,
  match_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  score numeric(14,2) default 0 not null,
  percentage numeric(8,2),
  completion_time_ms bigint,
  rank integer,
  tie_break_value numeric(14,4),
  result_status text default 'PROVISIONAL'::text not null,
  calculated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_rounds
create table if not exists public.competition_rounds (
  id uuid default gen_random_uuid() not null,
  stage_id uuid not null,
  round_no integer not null,
  name text not null,
  assessment_id uuid,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  status text default 'PENDING'::text not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_sponsors
create table if not exists public.competition_sponsors (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  sponsor_id uuid not null,
  sponsorship_role text default 'SPONSOR'::text not null,
  committed_amount numeric(14,2),
  currency text default 'GHS'::text not null,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_stages
create table if not exists public.competition_stages (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  stage_no integer not null,
  name text not null,
  stage_type text not null,
  qualification_rule jsonb default '{}'::jsonb not null,
  status text default 'PENDING'::text not null,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  PRIMARY KEY (id)
);

-- TABLE public.competition_team_members
create table if not exists public.competition_team_members (
  id uuid default gen_random_uuid() not null,
  team_id uuid not null,
  student_id uuid not null,
  role text default 'MEMBER'::text not null,
  roster_status text default 'PENDING'::text not null,
  verified_by uuid,
  verified_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competition_teams
create table if not exists public.competition_teams (
  id uuid default gen_random_uuid() not null,
  competition_id uuid not null,
  institution_id uuid,
  team_name text not null,
  team_code text,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.competitions
create table if not exists public.competitions (
  id uuid default gen_random_uuid() not null,
  sponsor_id uuid,
  assessment_id uuid,
  competition_type text default 'STANDARD'::text not null,
  title text not null,
  description text,
  subject_code text,
  grade text,
  country text,
  region text,
  registration_opens_at timestamp with time zone,
  registration_closes_at timestamp with time zone,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  entry_fee numeric(14,2) default 0 not null,
  currency text default 'GHS'::text not null,
  prize_pool numeric(14,2) default 0 not null,
  participant_limit integer,
  status text default 'DRAFT'::text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  tenant_id uuid,
  content_context_id uuid,
  PRIMARY KEY (id)
);

-- TABLE public.content_extraction_jobs
create table if not exists public.content_extraction_jobs (
  id uuid default gen_random_uuid() not null,
  source_document_id uuid not null,
  job_type text default 'STRUCTURE_EXTRACTION'::text not null,
  status text default 'PENDING'::text not null,
  provider text,
  model text,
  output jsonb,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.content_licenses
create table if not exists public.content_licenses (
  id uuid default gen_random_uuid() not null,
  content_type text not null,
  content_id uuid not null,
  owner_type text not null,
  owner_id uuid not null,
  license_type text not null,
  license_terms text,
  commercial_use_allowed boolean default false not null,
  redistribution_allowed boolean default false not null,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.content_reports
create table if not exists public.content_reports (
  id uuid default gen_random_uuid() not null,
  reporter_user_id uuid,
  target_type text not null,
  target_id uuid not null,
  report_type text not null,
  description text,
  status text default 'OPEN'::text not null,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.content_reviews
create table if not exists public.content_reviews (
  id uuid default gen_random_uuid() not null,
  content_type text not null,
  content_id uuid not null,
  reviewer_id uuid,
  review_type text default 'EDITORIAL'::text not null,
  status text default 'PENDING'::text not null,
  score numeric(8,2),
  comments text,
  findings jsonb default '{}'::jsonb not null,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.daily_metrics
create table if not exists public.daily_metrics (
  id uuid default gen_random_uuid() not null,
  metric_date date not null,
  tenant_id uuid,
  metric_domain text not null,
  metric_name text not null,
  dimension jsonb default '{}'::jsonb not null,
  metric_value numeric(20,4) default 0 not null,
  calculated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.entitlements
create table if not exists public.entitlements (
  id uuid default gen_random_uuid() not null,
  beneficiary_user_id uuid not null,
  source_type text not null,
  source_id uuid,
  entitlement_type text not null,
  scope jsonb default '{}'::jsonb not null,
  starts_at timestamp with time zone default now() not null,
  ends_at timestamp with time zone,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  product_id uuid,
  order_item_id uuid,
  PRIMARY KEY (id)
);

-- TABLE public.escrow_accounts
create table if not exists public.escrow_accounts (
  id uuid default gen_random_uuid() not null,
  competition_id uuid,
  currency text default 'GHS'::text not null,
  funded_amount numeric(14,2) default 0 not null,
  reserved_amount numeric(14,2) default 0 not null,
  released_amount numeric(14,2) default 0 not null,
  status text default 'OPEN'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.escrow_ledger
create table if not exists public.escrow_ledger (
  id uuid default gen_random_uuid() not null,
  escrow_account_id uuid not null,
  transaction_type text not null,
  amount numeric(14,2) not null,
  reference_type text,
  reference_id uuid,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.feature_flags
create table if not exists public.feature_flags (
  id uuid default gen_random_uuid() not null,
  feature_code text not null,
  enabled boolean default false not null,
  rollout_config jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.marketplace_listings
create table if not exists public.marketplace_listings (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  channel text default 'QUIZBOX_MARKETPLACE'::text not null,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  status text default 'DRAFT'::text not null,
  published_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.marketplace_moderation
create table if not exists public.marketplace_moderation (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  reviewer_id uuid,
  moderation_status text default 'PENDING'::text not null,
  comments text,
  findings jsonb default '{}'::jsonb not null,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.marketplace_product_items
create table if not exists public.marketplace_product_items (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  item_type text not null,
  item_id uuid not null,
  display_order integer,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.marketplace_products
create table if not exists public.marketplace_products (
  id uuid default gen_random_uuid() not null,
  seller_id uuid not null,
  tenant_id uuid,
  product_type text not null,
  title text not null,
  description text,
  subject_code text,
  grade text,
  license_type text default 'PERSONAL'::text not null,
  price numeric(14,2) default 0 not null,
  currency text default 'GHS'::text not null,
  visibility text default 'PUBLIC'::text not null,
  moderation_status text default 'DRAFT'::text not null,
  status text default 'DRAFT'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.marketplace_sellers
create table if not exists public.marketplace_sellers (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  seller_type text not null,
  seller_entity_id uuid not null,
  display_name text not null,
  verification_status text default 'PENDING'::text not null,
  payout_status text default 'NOT_CONFIGURED'::text not null,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.media_assets
create table if not exists public.media_assets (
  id uuid default gen_random_uuid() not null,
  storage_bucket text default 'question-media'::text not null,
  storage_path text not null,
  media_type text not null,
  mime_type text,
  original_filename text,
  width integer,
  height integer,
  alt_text text,
  caption text,
  source_type text,
  source_reference text,
  checksum text,
  status text default 'ACTIVE'::text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  byte_size integer,
  validated_at timestamp with time zone,
  PRIMARY KEY (id)
);

-- TABLE public.notification_deliveries
create table if not exists public.notification_deliveries (
  id uuid default gen_random_uuid() not null,
  notification_id uuid not null,
  channel text not null,
  destination text,
  provider text,
  status text default 'PENDING'::text not null,
  attempted_at timestamp with time zone,
  delivered_at timestamp with time zone,
  provider_reference text,
  error_message text,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.order_items
create table if not exists public.order_items (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  product_id uuid not null,
  seller_id uuid,
  quantity integer default 1 not null,
  unit_price numeric(14,2) not null,
  line_total numeric(14,2) not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.orders
create table if not exists public.orders (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  buyer_user_id uuid,
  order_number text not null,
  currency text default 'GHS'::text not null,
  subtotal numeric(14,2) default 0 not null,
  discount_amount numeric(14,2) default 0 not null,
  total_amount numeric(14,2) default 0 not null,
  payment_status text default 'UNPAID'::text not null,
  fulfillment_status text default 'PENDING'::text not null,
  status text default 'OPEN'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.payout_accounts
create table if not exists public.payout_accounts (
  id uuid default gen_random_uuid() not null,
  seller_id uuid not null,
  provider text not null,
  account_type text not null,
  account_reference_encrypted text,
  display_reference text,
  verification_status text default 'PENDING'::text not null,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.payouts
create table if not exists public.payouts (
  id uuid default gen_random_uuid() not null,
  seller_id uuid not null,
  payout_account_id uuid,
  currency text default 'GHS'::text not null,
  amount numeric(14,2) not null,
  provider text,
  provider_reference text,
  status text default 'PENDING'::text not null,
  requested_at timestamp with time zone default now() not null,
  processed_at timestamp with time zone,
  PRIMARY KEY (id)
);

-- TABLE public.permissions
create table if not exists public.permissions (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  description text,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.plans
create table if not exists public.plans (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  audience text default 'STUDENT'::text not null,
  price numeric(14,2) default 0 not null,
  currency text default 'GHS'::text not null,
  billing_period text,
  features jsonb default '{}'::jsonb not null,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.points_ledger
create table if not exists public.points_ledger (
  id uuid default gen_random_uuid() not null,
  student_id uuid not null,
  event_type text not null,
  reference_type text,
  reference_id uuid,
  points_delta integer not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.product_reviews
create table if not exists public.product_reviews (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  reviewer_user_id uuid not null,
  order_item_id uuid,
  rating integer not null,
  review_text text,
  status text default 'PUBLISHED'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.question_bank_items
create table if not exists public.question_bank_items (
  id uuid default gen_random_uuid() not null,
  bank_id uuid not null,
  question_id uuid not null,
  display_order integer,
  added_by uuid,
  added_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.question_bank_versions
create table if not exists public.question_bank_versions (
  id uuid default gen_random_uuid() not null,
  bank_id uuid not null,
  version_no integer not null,
  snapshot jsonb not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.question_banks
create table if not exists public.question_banks (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  institution_id uuid,
  created_by uuid,
  owner_type text not null,
  owner_id uuid not null,
  title text not null,
  description text,
  subject_code text,
  grade text,
  visibility text default 'PRIVATE'::text not null,
  marketplace_eligible boolean default false not null,
  commercial_status text default 'NOT_LISTED'::text not null,
  version_no integer default 1 not null,
  status text default 'DRAFT'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  market_id uuid,
  PRIMARY KEY (id)
);

-- TABLE public.question_generation_jobs
create table if not exists public.question_generation_jobs (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  source_document_id uuid,
  question_bank_id uuid,
  requested_by uuid,
  subject_code text,
  grade text,
  requested_count integer,
  generation_config jsonb default '{}'::jsonb not null,
  provider text,
  model text,
  status text default 'PENDING'::text not null,
  generated_count integer default 0 not null,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.question_media
create table if not exists public.question_media (
  id uuid default gen_random_uuid() not null,
  question_id uuid not null,
  media_asset_id uuid not null,
  usage_type text default 'QUESTION'::text not null,
  option_key text,
  display_order integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.question_options
create table if not exists public.question_options (
  id uuid default gen_random_uuid() not null,
  question_id uuid not null,
  option_key text not null,
  display_order integer not null,
  content jsonb not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.question_versions
create table if not exists public.question_versions (
  id uuid default gen_random_uuid() not null,
  question_id uuid not null,
  version_no integer not null,
  snapshot jsonb not null,
  change_reason text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.role_permissions
create table if not exists public.role_permissions (
  id uuid default gen_random_uuid() not null,
  role text not null,
  permission_id uuid not null,
  allowed boolean default true not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.seller_earnings
create table if not exists public.seller_earnings (
  id uuid default gen_random_uuid() not null,
  seller_id uuid not null,
  order_item_id uuid not null,
  currency text default 'GHS'::text not null,
  gross_amount numeric(14,2) not null,
  platform_fee numeric(14,2) default 0 not null,
  seller_net_amount numeric(14,2) not null,
  earning_status text default 'PENDING'::text not null,
  available_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.source_documents
create table if not exists public.source_documents (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  institution_id uuid,
  uploaded_by uuid,
  document_type text default 'CURRICULUM'::text not null,
  title text not null,
  storage_bucket text,
  storage_path text,
  mime_type text,
  checksum text,
  ownership_type text,
  rights_confirmed boolean default false not null,
  status text default 'UPLOADED'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  market_id uuid,
  curriculum_id uuid,
  authority_id uuid,
  sponsor_id uuid,
  source_kind text default 'CURRICULUM'::text not null,
  validation_status text default 'review'::text not null,
  approved_by uuid,
  content_text text,
  PRIMARY KEY (id)
);

-- TABLE public.sponsor_profiles
create table if not exists public.sponsor_profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  sponsor_type text,
  organization_name text,
  contact_name text,
  website text,
  country text,
  region text,
  verification_status text default 'PENDING'::text not null,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.sponsorship_targets
create table if not exists public.sponsorship_targets (
  id uuid default gen_random_uuid() not null,
  sponsorship_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  allocated_amount numeric(14,2),
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.sponsorships
create table if not exists public.sponsorships (
  id uuid default gen_random_uuid() not null,
  sponsor_id uuid not null,
  name text not null,
  description text,
  sponsorship_type text default 'GENERAL'::text not null,
  budget_amount numeric(14,2),
  currency text default 'GHS'::text not null,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  status text default 'DRAFT'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.student_badges
create table if not exists public.student_badges (
  id uuid default gen_random_uuid() not null,
  student_id uuid not null,
  badge_id uuid not null,
  reference_type text,
  reference_id uuid,
  awarded_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.subscriptions
create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() not null,
  subscriber_type text not null,
  subscriber_id uuid not null,
  plan_id uuid not null,
  starts_at timestamp with time zone default now() not null,
  renews_at timestamp with time zone,
  ends_at timestamp with time zone,
  status text default 'ACTIVE'::text not null,
  payment_provider text,
  external_subscription_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.system_events
create table if not exists public.system_events (
  id uuid default gen_random_uuid() not null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  severity text default 'INFO'::text not null,
  details jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.tenant_branding
create table if not exists public.tenant_branding (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  display_name text,
  logo_asset_id uuid,
  primary_color text,
  secondary_color text,
  accent_color text,
  favicon_asset_id uuid,
  custom_css text,
  login_message text,
  footer_text text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.tenant_domains
create table if not exists public.tenant_domains (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  domain text not null,
  domain_type text default 'CUSTOM'::text not null,
  verification_status text default 'PENDING'::text not null,
  verified_at timestamp with time zone,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.tenant_features
create table if not exists public.tenant_features (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  feature_code text not null,
  enabled boolean default true not null,
  limits jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.tenant_institutions
create table if not exists public.tenant_institutions (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  institution_id uuid not null,
  relationship_type text default 'OWNED'::text not null,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.tenant_memberships
create table if not exists public.tenant_memberships (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  user_id uuid not null,
  role text default 'MEMBER'::text not null,
  status text default 'ACTIVE'::text not null,
  joined_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.tenant_settings
create table if not exists public.tenant_settings (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  settings jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);

-- TABLE public.tenants
create table if not exists public.tenants (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  tenant_type text default 'INSTITUTION'::text not null,
  legal_name text,
  country text,
  region text,
  primary_contact_user_id uuid,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  market_id uuid,
  PRIMARY KEY (id)
);

-- TABLE public.transactions
create table if not exists public.transactions (
  id uuid default gen_random_uuid() not null,
  transaction_type text not null,
  payer_user_id uuid,
  beneficiary_user_id uuid,
  reference_type text,
  reference_id uuid,
  amount numeric(14,2) not null,
  currency text default 'GHS'::text not null,
  provider text,
  provider_reference text,
  status text default 'PENDING'::text not null,
  initiated_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb not null,
  PRIMARY KEY (id)
);

-- TABLE public.validation_runs
create table if not exists public.validation_runs (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  target_type text not null,
  target_id uuid not null,
  validation_type text not null,
  status text default 'PENDING'::text not null,
  result jsonb,
  passed_count integer default 0 not null,
  failed_count integer default 0 not null,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
