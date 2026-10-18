-- Rollback for 20261018120000_grant_hardening_table_maintenance: give TRUNCATE, REFERENCES and TRIGGER back to the client roles (Supabase defaults).
begin;
do $undo$
declare s text; t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm', 'f') and (n.nspname = 'public' or n.nspname like 'quizbox\_%')
  loop
    execute format('grant truncate, references, trigger on table %I.%I to anon, authenticated', t.schema_name, t.table_name);
  end loop;
  for s in select nspname from pg_namespace where nspname = 'public' or nspname like 'quizbox\_%' loop
    execute format('alter default privileges in schema %I grant truncate, references, trigger on tables to anon, authenticated', s);
  end loop;
end $undo$;
commit;
