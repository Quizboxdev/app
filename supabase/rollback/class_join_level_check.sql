-- Rollback for 20261063100000_class_join_level_check.sql: joining a class goes back to checking the code, status and expiry only (no class-level check).
-- These are the bodies from 20261002170000_production_readiness_security.sql.
begin;
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
commit;
