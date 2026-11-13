begin;
-- Staff access (flag flags.staff_access, default OFF). A super admin gives a colleague, by email, one or more connected workflows. Each workflow is a bundle of the admin tabs that work together,
-- and maps to a staff capability the database already enforces on every action: content (content_admin), support (sme_support), finance (finance_admin). Nothing here widens what those
-- capabilities allow; it gives the super admin a screen to grant and withdraw them, and it tells the app which tabs to show. Only a super admin can use these functions, never to change another super admin.
--   public.qb_my_staff_access()            the caller's workflows, for the menu (empty while the flag is off)
--   public.qb_staff_list()                 who holds any workflow (super admin)
--   public.qb_staff_find(email)            one account and the workflows it holds (super admin)
--   public.qb_staff_set(user, workflows)   makes the account hold exactly these workflows; the rest are withdrawn (super admin); recorded in the audit log
-- Other capabilities an account holds (reviewer, super admin, and so on) are never touched. Errors: QB_FEATURE_DISABLED, SUPER_ADMIN_REQUIRED, ACCOUNT_NOT_FOUND, ACCOUNT_INACTIVE,
-- CANNOT_CHANGE_SUPER_ADMIN, INVALID_WORKFLOW, NOTHING_CHANGED.
-- Rollback: supabase/rollback/staff_access.sql (grants already made stay, as ordinary capabilities).

insert into public.platform_settings(key, value, description) values
  ('flags.staff_access', 'false', 'A super admin can give staff connected workflows by email; the menu follows')
on conflict do nothing;

create schema if not exists quizbox_staff;
revoke all on schema quizbox_staff from public, anon, authenticated;

-- The one place that says which capability each workflow stands for.
create or replace function quizbox_staff.capability_of(p_workflow text) returns text language sql immutable set search_path = '' as $fn$
  select case p_workflow when 'content' then 'content_admin' when 'support' then 'sme_support' when 'finance' then 'finance_admin' end;
$fn$;

create or replace function quizbox_staff.workflows_of(p_user uuid) returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(w order by w), '{}') from unnest(array['content', 'support', 'finance']) w
   where exists (select 1 from public.user_capabilities c where c.user_id = p_user and c.active and c.capability = quizbox_staff.capability_of(w));
$fn$;

create or replace function quizbox_staff.guard() returns void language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if not quizbox_core.flag('flags.staff_access') then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
end $fn$;

create or replace function public.qb_my_staff_access() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare on_ boolean := quizbox_core.flag('flags.staff_access');
begin
  if auth.uid() is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return jsonb_build_object('enabled', on_, 'workflows', case when on_ then to_jsonb(quizbox_staff.workflows_of(auth.uid())) else '[]'::jsonb end);
end $fn$;

create or replace function public.qb_staff_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_staff.guard();
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'email', p.email, 'full_name', p.full_name, 'role', p.role, 'status', p.status,
      'workflows', to_jsonb(quizbox_staff.workflows_of(p.id)), 'since', x.since) order by p.full_name)
    from public.profiles p
    join (select c.user_id, min(c.created_at) since from public.user_capabilities c where c.active and c.capability in ('content_admin', 'sme_support', 'finance_admin') group by c.user_id) x on x.user_id = p.id), '[]'::jsonb);
end $fn$;

create or replace function public.qb_staff_find(p_email text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare p public.profiles; e text := lower(btrim(coalesce(p_email, '')));
begin
  perform quizbox_staff.guard();
  if e = '' then raise exception 'ACCOUNT_NOT_FOUND' using errcode = '22023'; end if;
  select * into p from public.profiles where lower(email) = e limit 1;
  if not found then raise exception 'ACCOUNT_NOT_FOUND' using errcode = '22023'; end if;
  return jsonb_build_object('user_id', p.id, 'email', p.email, 'full_name', p.full_name, 'role', p.role, 'status', p.status,
    'is_super', exists (select 1 from public.user_capabilities c where c.user_id = p.id and c.active and c.capability = 'super_admin') or lower(p.role::text) = 'owner',
    'workflows', to_jsonb(quizbox_staff.workflows_of(p.id)));
end $fn$;

create or replace function public.qb_staff_set(p_user uuid, p_workflows text[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare p public.profiles; w text; want text[]; before_w text[]; after_w text[];
begin
  perform quizbox_staff.guard();
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'ACCOUNT_NOT_FOUND' using errcode = '22023'; end if;
  if lower(p.status::text) <> 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode = '22023'; end if;
  if lower(p.role::text) = 'owner' or exists (select 1 from public.user_capabilities c where c.user_id = p.id and c.active and c.capability = 'super_admin') then
    raise exception 'CANNOT_CHANGE_SUPER_ADMIN' using errcode = '42501'; end if;
  want := array(select distinct x from unnest(coalesce(p_workflows, '{}')) x order by x);
  foreach w in array want loop
    if quizbox_staff.capability_of(w) is null then raise exception 'INVALID_WORKFLOW' using errcode = '22023'; end if;
  end loop;
  before_w := quizbox_staff.workflows_of(p.id);
  if before_w = want then raise exception 'NOTHING_CHANGED' using errcode = '22023'; end if;
  foreach w in array array['content', 'support', 'finance'] loop
    if w = any(want) then
      insert into public.user_capabilities(user_id, capability, active, granted_by) values (p.id, quizbox_staff.capability_of(w), true, auth.uid())
      on conflict (user_id, capability) do update set active = true, granted_by = excluded.granted_by;
    else
      update public.user_capabilities set active = false where user_id = p.id and capability = quizbox_staff.capability_of(w) and active;
    end if;
  end loop;
  after_w := quizbox_staff.workflows_of(p.id);
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
    values (auth.uid(), 'staff_access_set', 'profile', p.id, 'ok', jsonb_build_object('email', p.email, 'before', to_jsonb(before_w), 'after', to_jsonb(after_w)));
  return jsonb_build_object('ok', true, 'user_id', p.id, 'workflows', to_jsonb(after_w));
end $fn$;

revoke all on function public.qb_my_staff_access(), public.qb_staff_list(), public.qb_staff_find(text), public.qb_staff_set(uuid, text[]) from public, anon, authenticated;
grant execute on function public.qb_my_staff_access(), public.qb_staff_list(), public.qb_staff_find(text), public.qb_staff_set(uuid, text[]) to authenticated;
revoke all on function quizbox_staff.capability_of(text), quizbox_staff.workflows_of(uuid), quizbox_staff.guard() from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
