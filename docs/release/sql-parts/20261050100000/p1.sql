-- QuizBox: signed-out visitors (the Supabase "anon" role) can no longer write to any table.
-- Found in the 2026-10-31 review of the Production schema:
--   * anon held INSERT, UPDATE, DELETE and MAINTAIN on 54 tables. Row-level security stopped every case except one, so this removes the grants as a second line of defence.
--   * public.support_tickets had an insert policy named for authenticated users that was not restricted to that role and also accepted requester_user_id IS NULL,
--     so a signed-out visitor holding only the public anon key could insert tickets. The table is read only by Admin; the public contact form writes through a server-only function.
-- Reads are unchanged: the ten views are security_invoker and every table has row-level security, so anon still sees nothing it should not.
-- Additive and idempotent. Rollback: supabase/rollback/anon_no_write_grants.sql.
begin;

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
-- MAINTAIN exists from PostgreSQL 17. REVOKE ALL below covers it on versions that have it and is harmless on older ones; SELECT is granted back immediately.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege('anon', c.oid, 'SELECT')
  loop
    execute format('revoke all on table public.%I from anon', r.relname);
    execute format('grant select on table public.%I to anon', r.relname);
  end loop;
end $$;

-- New tables must not hand anon write access by default.
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;

drop policy if exists support_insert_authenticated on public.support_tickets;
create policy support_insert_authenticated on public.support_tickets for insert to authenticated with check (requester_user_id = auth.uid());

commit;
