begin;
-- A learner can only join a class for their own class level. Before this, a Basic 4 learner who had a Basic 5 or SHS 3 join code was let in with no warning (intern feedback, 2026-11-11).
-- The check compares the learner's canonical grade (quizbox_market.student_grade_code, the same one the access rules use) with the class's grade, read through the same market grade list.
-- If either grade cannot be worked out, the learner is let in as before: the rule only ever refuses a clear mismatch.
-- Only joining by code is checked. Young learners a teacher creates (managed learners) and school transfers are placed by staff through their own functions and are not affected.
-- A learner who signed up at the wrong level is refused until their level is corrected, so correcting a level (a support or account change) matters more once this is live.
-- The new refusal is CLASS_LEVEL_MISMATCH. Both functions are replaced with their previous bodies plus that check; signatures and grants are unchanged.
-- Rollback: supabase/rollback/class_join_level_check.sql

create or replace function quizbox_private.join_class_core(p_join_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_class public.classes;
  v_student uuid;
  v_membership public.class_memberships;
  v_student_grade text;
  v_class_grade text;
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

  -- The class level must match the learner's own. The class grade goes through the learner's market grade list, exactly as the learner's own grade does.
  v_student_grade := quizbox_market.student_grade_code(auth.uid());
  v_class_grade := coalesce(
    (select x->>'canonical'
       from public.profiles p
       join public.markets m on m.id = coalesce(p.primary_market_id, p.default_market_id)
      cross join jsonb_array_elements(coalesce(m.configuration->'grades', '[]'::jsonb)) x
      where p.id = auth.uid() and x->>'code' = coalesce(nullif(v_class.grade_code, ''), v_class.grade::text) and nullif(x->>'canonical', '') is not null
      limit 1),
    case when coalesce(nullif(v_class.grade_code, ''), v_class.grade::text) = 'B10' then 'SHS1' else coalesce(nullif(v_class.grade_code, ''), v_class.grade::text) end);
  if v_student_grade is not null and v_class_grade is not null and upper(v_student_grade) <> upper(v_class_grade) then
    raise exception 'CLASS_LEVEL_MISMATCH';
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
$function$;

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
  code:=case when sqlerrm in ('INVALID_CLASS_CODE','CLASS_NOT_ACTIVE','CLASS_CODE_EXPIRED','STUDENT_PROFILE_REQUIRED','CLASS_LEVEL_MISMATCH') then sqlerrm else 'QB_OPERATION_FAILED' end;
  insert into public.audit_logs(actor_user_id,action,status,details) values(auth.uid(),'QB_OP_CLASS_JOIN','fail',jsonb_build_object('origin','database','error_code',code));
  return jsonb_build_object('error',code);
 end;
end $$;
commit;
