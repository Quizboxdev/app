-- Rollback for 20261019110000_subscription_payments. Subscriptions already granted stay; payment intents and the Coin ledger are untouched.
drop function if exists public.qb_admin_payments(integer);
drop function if exists public.qb_revoke_subscription_payment(text, text);
drop function if exists public.qb_fulfil_subscription_payment(text);
drop function if exists public.qb_set_payment_plan(text, text, integer);
drop function if exists public.qb_subscription_catalog();
