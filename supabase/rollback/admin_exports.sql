-- Rollback for 20261045100000_admin_exports.sql: removes the export functions. They only read data, so nothing else changes and no data is lost.
begin;
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'qb\_export\_%' loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
