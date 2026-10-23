-- Rollback for 20261035100000_refund_cases.sql. Removes the refund tools and the case log. Coins already credited stay on the buyers' wallets (the ledger rows are not touched).
begin;
drop function if exists public.qb_admin_refund_cases(integer);
drop function if exists public.qb_admin_refund_case_save(text, text, text, text, uuid, boolean);
drop function if exists public.qb_admin_refund_credit(text, integer, text, uuid, boolean);
drop function if exists public.qb_admin_payment_facts(text);
drop table if exists public.refund_cases;
commit;
notify pgrst, 'reload schema';
