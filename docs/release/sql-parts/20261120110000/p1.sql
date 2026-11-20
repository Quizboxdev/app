-- December 2026 release-readiness gate, finding found on PREVIEW (Production already has these rules, checked read-only on 2026-11-19).
-- Preview was rebuilt with Supabase's default open table grants, so a signed-in learner could (a) change their own profiles.role to admin and (b) hold TRUNCATE on 183 public tables.
-- Production keeps the rule set by 20261002150000 (browser role may update only profiles.full_name) and holds no TRUNCATE. This migration states both rules again, so any rebuilt
-- database ends up the same as Production. On Production it changes nothing. Safe to apply more than once.
-- Rollback: supabase/rollback/reassert_browser_role_grants.sql (restores Preview's old open grants for profiles only; do not use it on Production).
begin;
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

do $$
declare t record;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
commit;
