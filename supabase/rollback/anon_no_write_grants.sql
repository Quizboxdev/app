-- Rollback for 20261050100000_anon_no_write_grants.sql. Restores the previous behaviour, including the weaker support_tickets policy.
-- Prefer leaving the fix in place: the only effect of rolling back is that signed-out visitors regain write grants that row-level security was blocking anyway.
begin;
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'INSERT')
  loop
    execute format('grant insert, update, delete on table public.%I to anon', r.relname);
  end loop;
end $$;
drop policy if exists support_insert_authenticated on public.support_tickets;
create policy support_insert_authenticated on public.support_tickets for insert with check (requester_user_id = auth.uid() or requester_user_id is null);
commit;
