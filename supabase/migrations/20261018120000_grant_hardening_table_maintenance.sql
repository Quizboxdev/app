-- Grant hardening, part 1 (tracker C6; completion plan Phase 3 step 2).
-- Supabase gives the client roles every table privilege by default. Browsers never need to TRUNCATE a table, create foreign keys to it
-- (REFERENCES) or attach triggers (TRIGGER), so those three are removed from anon and authenticated on every table in the application schemas.
-- SELECT, INSERT, UPDATE and DELETE are untouched (row-level security governs them), so no screen changes behaviour.
-- Default privileges are tightened too, so tables created later do not get these rights back.
-- Part 2 (narrowing anon's SELECT and write grants) needs the production grant list first; it is not in this migration.
begin;

do $hard$
declare s text; t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (n.nspname = 'public' or n.nspname like 'quizbox\_%')
  loop
    execute format('revoke truncate, references, trigger on table %I.%I from anon, authenticated', t.schema_name, t.table_name);
  end loop;
  for s in select nspname from pg_namespace where nspname = 'public' or nspname like 'quizbox\_%' loop
    execute format('alter default privileges in schema %I revoke truncate, references, trigger on tables from anon, authenticated', s);
  end loop;
end $hard$;

commit;
