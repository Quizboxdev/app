-- Bootstrap for a fresh database (tracker C7: the chain must replay from empty).
-- A few early helpers were created by hand on the hosted production database and were never written into a migration, so the chain stopped at
-- 20261001160000 on any new database. Each helper is created ONLY IF IT DOES NOT EXIST: on production (where the hand-made definition is already
-- in place and stays in place) this migration changes nothing; on a new Preview or test database it supplies a safe equivalent.
begin;

do $boot$
begin
  -- Platform admin: an active administrator profile. (Production's own definition is kept wherever it already exists.)
  if to_regprocedure('public.qb_is_platform_admin()') is null then
    execute $f$
      create function public.qb_is_platform_admin() returns boolean language sql stable security definer set search_path = '' as $b$
        select auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) in ('admin', 'owner') and lower(p.status::text) = 'active')
      $b$ $f$;
  end if;
end $boot$;

commit;
