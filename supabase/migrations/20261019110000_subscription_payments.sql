-- Subscription payments on top of the core payment ledger (completion plan Phase 5). Money buys Coins through the existing, tested flow
-- (qb_payment_intent_create -> provider -> verified webhook -> qb_payment_apply_event credits the wallet). A paid subscription then SPENDS those Coins
-- (one audited ledger trail, refunds and reconciliation already handled) and creates the learner_subscriptions row the access gate reads.
-- Requires 20261007100000 (core platform) and 20261018100000 (standalone access gate), both present in production.
--   qb_subscription_catalog()                      signed-in users: whether payments are on, the currency and the unit price (prices for the Subscribe page)
--   qb_set_payment_plan(reference, plan, days)     service_role only: records which plan an intent is for
--   qb_fulfil_subscription_payment(reference)      service_role only: after settlement, spend the Coins and grant the subscription (idempotent)
--   qb_revoke_subscription_payment(reference, why) service_role only: a refunded or reversed payment ends its subscription
--   qb_admin_payments(limit)                       super admin or finance admin: recent payments with status and reconciliation
begin;

create or replace function public.qb_subscription_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare cur text := 'GHS';
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('payments_enabled', quizbox_core.flag('flags.buy_coins_enabled') and quizbox_core.flag('flags.student_self_pay'),
    'currency', cur, 'unit_price_minor', (quizbox_core.setting('coins.unit_price_minor') ->> cur)::bigint,
    'providers', coalesce(quizbox_core.setting('payments.providers'), '[]'::jsonb));
end $fn$;

create or replace function public.qb_set_payment_plan(p_reference text, p_plan text, p_days integer) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  if p_days is null or p_days not between 1 and 731 or length(btrim(coalesce(p_plan, ''))) not between 2 and 60 then raise exception 'QB_INVALID_PLAN'; end if;
  update public.payment_intents set metadata = metadata || jsonb_build_object('plan', btrim(p_plan), 'days', p_days, 'purpose', 'subscription')
   where reference = p_reference and status in ('initiated', 'pending', 'awaiting_approval', 'processing');
  if not found then raise exception 'QB_NOT_FOUND'; end if;
end $fn$;

create or replace function public.qb_fulfil_subscription_payment(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare i public.payment_intents; sub public.learner_subscriptions; base timestamptz; days integer; plan text;
begin
  select * into i from public.payment_intents where reference = p_reference for update;
  if i.id is null then raise exception 'QB_NOT_FOUND'; end if;
  if i.metadata ->> 'purpose' is distinct from 'subscription' then return jsonb_build_object('outcome', 'not_a_subscription'); end if;
  if i.status <> 'successful' or i.credited_tx_id is null then return jsonb_build_object('outcome', 'not_settled'); end if;
  select * into sub from public.learner_subscriptions where source = 'payment' and source_ref = p_reference;
  if sub.id is not null then return jsonb_build_object('outcome', 'already_fulfilled', 'subscription_id', sub.id, 'valid_until', sub.valid_until); end if;
  plan := i.metadata ->> 'plan'; days := (i.metadata ->> 'days')::integer;
  -- the Coins were credited at settlement; the subscription spends them, with a key that makes a replay a no-op
  perform public.qb_coin_spend(i.beneficiary_user_id, i.coins, 'subscription:' || plan, p_reference, 'sub:' || p_reference, null);
  select greatest(now(), coalesce(max(valid_until), now())) into base from public.learner_subscriptions where user_id = i.beneficiary_user_id and status = 'active';
  insert into public.learner_subscriptions(user_id, plan, valid_from, valid_until, source, source_ref, note, created_by)
  values (i.beneficiary_user_id, plan, base, base + make_interval(days => days), 'payment', p_reference, 'Paid ' || p_reference, i.payer_user_id) returning * into sub;
  return jsonb_build_object('outcome', 'fulfilled', 'subscription_id', sub.id, 'valid_until', sub.valid_until);
end $fn$;

create or replace function public.qb_revoke_subscription_payment(p_reference text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  update public.learner_subscriptions set status = 'revoked', revoked_at = now(), note = coalesce(note, '') || ' | revoked: ' || left(coalesce(nullif(btrim(p_reason), ''), 'payment reversed'), 200)
   where source = 'payment' and source_ref = p_reference and status = 'active';
  get diagnostics n = row_count;
  return jsonb_build_object('revoked', n);
end $fn$;

create or replace function public.qb_admin_payments(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin', 'finance_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
    select jsonb_build_object('reference', i.reference, 'status', i.status, 'provider', i.provider, 'method', i.method, 'amount_minor', i.amount_minor, 'currency', i.currency_code,
        'coins', i.coins, 'plan', i.metadata ->> 'plan', 'reconciliation', i.reconciliation_status, 'learner', p.email, 'created_at', i.created_at, 'settled_at', i.settled_at) as x
      from public.payment_intents i join public.profiles p on p.id = i.beneficiary_user_id order by i.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) y), '[]'::jsonb);
end $fn$;

-- The gate and the Subscribe page also honour a paid subscription's end date (qb_my_access already returns it through learner_subscriptions).
revoke all on function public.qb_set_payment_plan(text, text, integer), public.qb_fulfil_subscription_payment(text), public.qb_revoke_subscription_payment(text, text) from public, anon, authenticated;
grant execute on function public.qb_set_payment_plan(text, text, integer), public.qb_fulfil_subscription_payment(text), public.qb_revoke_subscription_payment(text, text) to service_role;
revoke all on function public.qb_subscription_catalog(), public.qb_admin_payments(integer) from public, anon;
grant execute on function public.qb_subscription_catalog(), public.qb_admin_payments(integer) to authenticated;

commit;
