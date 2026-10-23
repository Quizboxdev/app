-- Rollback for 20261043100000_marketplace.sql: removes every Marketplace function, so nothing can be sold, bought, opened or paid out.
-- The tables (sellers, question sets, purchases, the money ledger, payout requests) and the settings are KEPT on purpose: they are financial records and must not be deleted by a rollback.
-- To remove the records as well (only before any real sale exists), drop the mk_* tables by hand.
begin;
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'qb\_mk\_%' loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
