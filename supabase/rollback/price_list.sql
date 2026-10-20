-- Rollback for 20261030100000_price_list.sql. Removes the price list and every price and link in it. The pricing page then falls back to config/subscription-plans.json.
drop function if exists public.qb_price_save(text, jsonb), public.qb_price_list_admin(), public.qb_price_list(), public.qb_price_admin();
drop table if exists public.price_list;
