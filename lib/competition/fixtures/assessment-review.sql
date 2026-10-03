-- Read-only exported existing review RPC. No hosted rows or credentials.
CREATE OR REPLACE FUNCTION public.qb_get_attempt_review(p_attempt_id uuid)
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
$function$;
