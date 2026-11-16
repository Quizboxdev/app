-- A learner picks the subjects they study from inside the workspace, after sign-up: qb_student_set_subjects(subjects).
-- Sign-up no longer asks for subjects. The list the learner sees comes from the market's configuration and is limited to their class level in the app.
-- Own account only; a learner managed by a teacher or guardian is changed by that adult. Unlike qb_update_student_profile this does NOT use up one of the two profile edits (class level and school keep that rule).
-- Errors: QB_AUTHENTICATION_REQUIRED, NOT_A_STUDENT, MANAGED_ACCOUNT, INVALID_SUBJECT. Additive and idempotent. Rollback: supabase/rollback/student_subjects.sql
create or replace function public.qb_student_set_subjects(p_subjects text[]) returns text[]
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); sp public.student_profiles; pr public.profiles; cfg jsonb; s text; v text[]; before_v text[];
begin
  if uid is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '28000'; end if;
  select * into pr from public.profiles where id = uid;
  select * into sp from public.student_profiles where user_id = uid and lower(status::text) = 'active' limit 1 for update;
  if not found or lower(pr.role::text) <> 'student' then raise exception 'NOT_A_STUDENT' using errcode = '42501'; end if;
  if sp.managed_by is not null then raise exception 'MANAGED_ACCOUNT' using errcode = '42501'; end if;
  if p_subjects is null or cardinality(p_subjects) > 20 then raise exception 'INVALID_SUBJECT' using errcode = '22023'; end if;
  select m.configuration into cfg from public.markets m where m.id = coalesce(pr.primary_market_id, pr.default_market_id);
  foreach s in array p_subjects loop
    if not exists (select 1 from jsonb_array_elements(coalesce(cfg->'subjects', '[]')) x where x->>'code' = s) then raise exception 'INVALID_SUBJECT' using errcode = '22023'; end if;
  end loop;
  before_v := array(select distinct x from unnest(coalesce(sp.subjects, '{}')) x order by x);
  v := array(select distinct x from unnest(p_subjects) x order by x);
  update public.student_profiles set subjects = v, updated_at = now() where id = sp.id;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (uid, 'student_subjects_set', 'student_profile', sp.id, 'ok', jsonb_build_object('before', to_jsonb(before_v), 'after', to_jsonb(v)));
  return v;
end $fn$;

revoke all on function public.qb_student_set_subjects(text[]) from public, anon, authenticated;
grant execute on function public.qb_student_set_subjects(text[]) to authenticated;
notify pgrst, 'reload schema';
