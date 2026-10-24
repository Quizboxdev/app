-- Puts qb_operation_failure back to its list before ATTEMPT_SAVE was allowed (migration 20261047100000). Safe to run at any time; saved log rows stay.
begin;

create or replace function public.qb_operation_failure(p_operation text,p_code text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform quizbox_private.enforce_budget('failure_events',20,60);
 if p_operation not in ('ATTEMPT_COMPLETION','ATTEMPT_START','CLASS_JOIN','GENERATION','IMPORT','REVIEW','EXTRACTION','SME_REVIEW','PUBLICATION','RESULT_PERSISTENCE','ONBOARDING') then raise exception 'QB_INVALID_EVENT'; end if;
 insert into public.audit_logs(actor_user_id,action,status,details)
 values(auth.uid(),'QB_OP_'||p_operation,'fail',jsonb_build_object('origin','client','error_code',case when p_code ~ '^[A-Z][A-Z0-9_]{2,60}$' then p_code else 'OPERATION_FAILED' end));
end $$;

-- Only signed-in users can report (the function refuses anyone else anyway); stated here so the permission does not depend on an older migration.
revoke all on function public.qb_operation_failure(text,text) from public,anon;
grant execute on function public.qb_operation_failure(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
