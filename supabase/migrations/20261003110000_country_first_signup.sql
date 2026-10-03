-- Country-first signup: the auth trigger no longer assumes a student with a national grade.
-- Legacy clients that still send `grade` keep the previous behaviour; new signups are profiled by
-- qb_complete_onboarding after the user confirms country and role.
begin;
create or replace function quizbox_private.on_signup() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if nullif(new.raw_user_meta_data->>'grade','') is not null then
  perform quizbox_private.provision_student(new.id,new.raw_user_meta_data->>'grade');
  update public.profiles set primary_market_id=coalesce(primary_market_id,default_market_id),onboarding_completed_at=coalesce(onboarding_completed_at,now()) where id=new.id;
 end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details)
 -- Country-first signups have no profile yet, so the actor is recorded only once a profile exists.
 values((select id from public.profiles where id=new.id),'QB_OP_SIGNUP','profiles',new.id,'pass',jsonb_build_object('origin','database','onboarding',case when nullif(new.raw_user_meta_data->>'grade','') is null then 'pending' else 'legacy' end));
 return new;
end $$;
commit;
