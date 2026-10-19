-- Teacher-managed learner accounts for children under 13 (tracker G8; owner decisions recorded in docs/security/UNDER_13_DESIGN.md).
-- Young children do not register themselves. A teacher creates accounts for the learners of a class they own: first name only, no email, no phone,
-- a generated username and password. The teacher must confirm that the school holds the guardian's consent, and that confirmation is stored.
-- Managed learners are blocked from public features (chat, public leaderboards with real names, sponsored prizes, paid challenges, discoverability).
-- The server route that creates the sign-in uses the service role; every database function below checks the teacher itself.
--   qb_managed_class_context(class)                   teacher: the class's grade, school and market (proves they own it)
--   qb_managed_learner_provision(...)                 service role only: builds the profile, class seat and consent record for a new sign-in
--   qb_managed_learner_list(class)                    teacher: the managed learners of a class (username, first name, status)
--   qb_managed_learner_authorise(teacher, learner)    service role only: may this teacher reset or archive this learner?
--   qb_managed_learner_archive(learner)               teacher: ends the account (inactive, removed from the class); data is kept for the school's retention period
--   qb_consume_budget(key, limit, seconds)            service role only: durable hourly limits for the route
--   qb_feature_allowed(feature)                       replaced: also blocks the managed-minor features
begin;

alter table public.student_profiles add column if not exists managed_by uuid references public.profiles(id);
alter table public.student_profiles add column if not exists is_minor boolean not null default false;
alter table public.student_profiles add column if not exists archived_at timestamptz;
create index if not exists student_profiles_managed_by on public.student_profiles(managed_by) where managed_by is not null;

insert into public.platform_settings(key, scope_type, value, description)
select 'safety.managed_minor_blocked_features', 'global', '["chat","public_leaderboards","public_discoverability","sponsored_prizes","paid_challenges"]'::jsonb,
       'Features never available to teacher-managed learners under 13'
 where not exists (select 1 from public.platform_settings where key = 'safety.managed_minor_blocked_features' and scope_type = 'global');

create or replace function public.qb_managed_class_context(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare c public.classes;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into c from public.classes where id = p_class;
  if c.id is null or lower(c.status::text) <> 'active' or not (c.teacher_user_id = auth.uid() or public.qb_is_platform_admin()) then raise exception 'QB_CLASS_NOT_MANAGED' using errcode = '42501'; end if;
  return jsonb_build_object('class_id', c.id, 'class_name', c.class_name, 'grade', c.grade::text, 'grade_label', c.grade_label, 'school', c.school_name);
end $fn$;

create or replace function public.qb_managed_learner_provision(p_teacher uuid, p_class uuid, p_user uuid, p_first_name text, p_username text, p_consent_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
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
end $fn$;

create or replace function public.qb_managed_learner_list(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.classes c where c.id = p_class and (c.teacher_user_id = auth.uid() or public.qb_is_platform_admin())) then raise exception 'QB_CLASS_NOT_MANAGED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'first_name', p.full_name, 'username', split_part(p.email, '@', 1), 'status', sp.status::text, 'created_at', sp.created_at,
      'archived_at', sp.archived_at) order by p.full_name)
    from public.class_memberships m join public.student_profiles sp on sp.user_id = m.student_user_id join public.profiles p on p.id = sp.user_id
   where m.class_id = p_class and sp.managed_by is not null), '[]'::jsonb);
end $fn$;

create or replace function public.qb_managed_learner_authorise(p_teacher uuid, p_learner uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.student_profiles sp where sp.user_id = p_learner and sp.managed_by is not null and sp.is_minor
                   and (sp.managed_by = p_teacher or exists (select 1 from public.class_memberships m join public.classes c on c.id = m.class_id where m.student_user_id = p_learner and c.teacher_user_id = p_teacher)))
$fn$;

create or replace function public.qb_managed_learner_archive(p_learner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not public.qb_managed_learner_authorise(auth.uid(), p_learner) then raise exception 'QB_MANAGED_LEARNER_NOT_FOUND' using errcode = '42501'; end if;
  update public.student_profiles set status = 'inactive', archived_at = now() where user_id = p_learner;
  update public.class_memberships set status = 'inactive' where student_user_id = p_learner;
  update public.profiles set status = 'inactive' where id = p_learner;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), 'QB_MANAGED_LEARNER_ARCHIVED', 'profiles', p_learner, 'pass', '{}'::jsonb);
  return jsonb_build_object('archived', true);
end $fn$;

create or replace function public.qb_consume_budget(p_key text, p_limit integer, p_seconds integer) returns boolean
language sql security definer set search_path = '' as $fn$ select quizbox_private.consume_intake_budget(left(p_key, 120), p_limit, p_seconds) $fn$;

-- Managed learners are blocked from public features whatever their consent status; everything else keeps the original consent rule.
create or replace function public.qb_feature_allowed(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select not (coalesce((select status from public.learner_consent where user_id = auth.uid()), 'not_required') in ('pending', 'withdrawn')
              and coalesce(quizbox_core.setting('safety.consent_pending_blocked_features'), '[]'::jsonb) ? p_feature)
     and not (exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.is_minor)
              and coalesce(quizbox_core.setting('safety.managed_minor_blocked_features'), '[]'::jsonb) ? p_feature);
$fn$;

revoke all on function public.qb_managed_class_context(uuid), public.qb_managed_learner_list(uuid), public.qb_managed_learner_archive(uuid) from public, anon;
grant execute on function public.qb_managed_class_context(uuid), public.qb_managed_learner_list(uuid), public.qb_managed_learner_archive(uuid) to authenticated;
revoke all on function public.qb_managed_learner_provision(uuid, uuid, uuid, text, text, text), public.qb_managed_learner_authorise(uuid, uuid), public.qb_consume_budget(text, integer, integer) from public, anon, authenticated;
grant execute on function public.qb_managed_learner_provision(uuid, uuid, uuid, text, text, text), public.qb_managed_learner_authorise(uuid, uuid), public.qb_consume_budget(text, integer, integer) to service_role;
revoke all on function public.qb_feature_allowed(text) from public, anon;
grant execute on function public.qb_feature_allowed(text) to authenticated;

commit;
