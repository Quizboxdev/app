-- Rollback for 20261048100000_affiliate_commission_foundation.sql: removes every affiliate and commission function, so nobody can apply, be attributed, accrue, reverse or be approved.
-- The tables (policies, affiliates, payout details, attributions, accruals and the commission ledger), their immutability triggers and the settings are KEPT on purpose: they are financial records and must not be deleted by a rollback.
-- qb_cm_guard stays because the triggers on the kept tables call it. To remove the records as well (only before any real commission exists), drop the commission_* and affiliate tables by hand.
-- Code that calls qb_commission_accrue / qb_commission_reverse treats "function not found" as "nothing to do", so customers' payments keep working after this rollback.
begin;
update public.platform_settings set value = 'false'::jsonb where key in ('flags.affiliates', 'flags.affiliate_payouts') and scope_type = 'global';
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname <> 'qb_cm_guard'
             and (p.proname like 'qb\_affiliate\_%' or p.proname like 'qb\_commission\_%' or p.proname like 'qb\_referral\_%' or p.proname like 'qb\_cm\_%') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
