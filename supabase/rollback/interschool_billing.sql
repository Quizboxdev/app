-- Rollback of 20261126130000_interschool_billing.sql. Run the rollbacks of the later inter-school migrations first (interschool_awards). Competition data held in the tables dropped here is lost: export it first if it matters.
begin;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
      'quizbox_interschool.require_billing',
      'quizbox_interschool.refresh_funding',
      'public.interschool_set_rate',
      'public.interschool_quote',
      'public.interschool_decide_quote',
      'public.interschool_fund_invoice',
      'public.interschool_payment_start',
      'public.interschool_payment_apply',
      'quizbox_interschool.aggregate',
      'public.interschool_payment_status',
      'public.interschool_sponsor_home',
      'public.interschool_billing')
  loop execute format('drop function if exists %s cascade', f.sig); end loop;
end $$;
drop table if exists quizbox_interschool.payment_attempts cascade;
drop table if exists quizbox_interschool.invoices cascade;
drop table if exists quizbox_interschool.quotations cascade;
drop sequence if exists quizbox_interschool.invoice_number;
commit;
notify pgrst, 'reload schema';
