-- Rollback for 20261024100000_managed_learner_lifecycle.sql. Removes the overview, reassign and scheduled-erase functions and the two settings.
-- Restores the fixed 12 month queue. It does not undo any reassignment or erasure already carried out.
begin;
drop function if exists public.qb_managed_reassign(text, text, boolean), public.qb_managed_overview(), public.qb_managed_set_auto_erase(boolean), public.qb_managed_erasure_due(integer),
  public.qb_managed_auto_erase_on(), public.qb_managed_retention_months();
delete from public.platform_settings where key in ('safety.managed_auto_erase', 'safety.managed_retention_months') and scope_type = 'global';
create or replace function public.qb_managed_erasure_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'first_name', p.full_name, 'username', split_part(p.email, '@', 1), 'ended_at', sp.archived_at) order by sp.archived_at)
    from public.student_profiles sp join public.profiles p on p.id = sp.user_id
   where sp.managed_by is not null and sp.is_minor and sp.erased_at is null and sp.archived_at is not null and sp.archived_at < now() - interval '12 months'), '[]'::jsonb);
end $fn$;
commit;
