-- Rollback for 20261031100000_coin_products.sql. Removes the Coin ladder rows and the new columns, and restores the earlier learner plans to active.
-- Afterwards re-apply 20261030100000_price_list.sql, which restores the earlier qb_price_list and qb_price_save functions.
update public.price_list set active = true where code in ('learner_monthly', 'learner_term');
delete from public.price_list where code in ('plan_weekly', 'plan_monthly', 'plan_term', 'plan_yearly', 'seats_10', 'seats_20', 'seats_50', 'seats_100', 'seats_200', 'seats_500', 'seats_1000');
alter table public.price_list drop constraint if exists price_list_coins_fixed_price;
alter table public.price_list drop column if exists coins, drop column if exists days, drop column if exists levels;
