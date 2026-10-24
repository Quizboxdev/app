-- Erasure of a teacher-managed learner's personal data (docs/security/UNDER_13_DESIGN.md, retention and deletion).
-- "Erase" removes everything that identifies the child (first name, username, school) and keeps the learning records in a form that no longer identifies
-- anyone, so class and school analytics stay correct. The account itself is not deleted: deleting it would cascade through attempts and responses.
-- Two ways in: a written request from a guardian or the school (the owner finds the learner and erases), and the retention rule (ended accounts older than
-- 12 months appear in a queue for the owner to erase in one pass). The server route that calls this also scrambles the sign-in so the old username is gone.
--   qb_managed_learner_erase(learner, reason)     service role only
--   qb_managed_erasure_queue()                    owner (super admin): ended accounts past retention, not yet erased
--   qb_managed_learner_find(username)             owner (super admin): look a learner up by username for a guardian's request
begin;

alter table public.student_profiles add column if not exists erased_at timestamptz;

create or replace function public.qb_managed_learner_erase(p_learner uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare sp public.student_profiles; tag text := 'erased-' || left(p_learner::text, 8);
begin
  select * into sp from public.student_profiles where user_id = p_learner for update;
  if sp.id is null or sp.managed_by is null or not sp.is_minor then raise exception 'QB_MANAGED_LEARNER_NOT_FOUND'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'QB_ERASURE_REASON_REQUIRED'; end if;
  if sp.erased_at is not null then return jsonb_build_object('erased', true, 'already', true); end if;
  update public.profiles set full_name = 'Former learner', email = tag || '@erased.invalid', school_name = null, phone = null, status = 'inactive' where id = p_learner;
  update public.class_memberships set student_name = 'Former learner', student_email = tag || '@erased.invalid', status = 'inactive' where student_user_id = p_learner;
  update public.student_profiles set school_name = null, status = 'inactive', archived_at = coalesce(archived_at, now()), erased_at = now() where user_id = p_learner;
  update public.learner_consent set policy_ref = 'erased', updated_at = now() where user_id = p_learner;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
  values (null, 'QB_MANAGED_LEARNER_ERASED', 'profiles', p_learner, 'pass', jsonb_build_object('reason', left(btrim(p_reason), 200)));
  return jsonb_build_object('erased', true, 'already', false, 'login_email', tag || '@erased.invalid');
end $fn$;

create or replace function public.qb_managed_erasure_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'first_name', p.full_name, 'username', split_part(p.email, '@', 1), 'ended_at', sp.archived_at) order by sp.archived_at)
    from public.student_profiles sp join public.profiles p on p.id = sp.user_id
   where sp.managed_by is not null and sp.is_minor and sp.erased_at is null and sp.archived_at is not null and sp.archived_at < now() - interval '12 months'), '[]'::jsonb);
end $fn$;

create or replace function public.qb_managed_learner_find(p_username text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'first_name', p.full_name, 'username', split_part(p.email, '@', 1), 'school', sp.school_name, 'status', sp.status::text,
      'erased', sp.erased_at is not null))
    from public.student_profiles sp join public.profiles p on p.id = sp.user_id
   where sp.managed_by is not null and sp.is_minor and lower(split_part(p.email, '@', 1)) = lower(btrim(coalesce(p_username, '')))), '[]'::jsonb);
end $fn$;

revoke all on function public.qb_managed_learner_erase(uuid, text) from public, anon, authenticated;
grant execute on function public.qb_managed_learner_erase(uuid, text) to service_role;
revoke all on function public.qb_managed_erasure_queue(), public.qb_managed_learner_find(text) from public, anon;
grant execute on function public.qb_managed_erasure_queue(), public.qb_managed_learner_find(text) to authenticated;

commit;
