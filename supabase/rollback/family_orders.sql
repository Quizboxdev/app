-- Rollback for 20261082100000_family_orders.sql: removes the functions. The two order tables stay, so no payment record is lost.
begin;
drop function if exists public.qb_family_wallets();
drop function if exists public.qb_family_orders();
drop function if exists public.qb_family_order_get(text);
drop function if exists public.qb_family_order_revoke(text, text);
drop function if exists public.qb_family_order_fulfil(text);
drop function if exists public.qb_family_order_apply(text, text, text, text, text, bigint, text, jsonb);
drop function if exists public.qb_family_order_create(text, jsonb, text);
drop function if exists quizbox_core.family_order_json(uuid);
commit;
