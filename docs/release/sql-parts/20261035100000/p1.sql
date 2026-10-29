-- Refund cases and the owner's Coin-credit tool (the refund policy at /refunds, decided 2026-10-23).
--   qb_admin_payment_facts(query)   finds payments by reference, Paystack reference or email and shows what the policy needs: credited? plan granted? Coins spent since? duplicates? inside 7 days?
--   qb_admin_refund_credit(...)     credits the extra Coins of a duplicate charge back to the buyer (kind "refund", purchased bucket), once per case, never more than the payment
--   qb_admin_refund_case_save(...)  records a request and its outcome; a cash refund may only be recorded when none of the purchase's Coins were used, inside 7 days
--   qb_admin_refund_cases(limit)    the list of cases
-- Owner and finance admins only (the checks are inside each function). A case row is never edited by a browser. Additive and idempotent. Rollback: supabase/rollback/refund_cases.sql.


create table if not exists public.refund_cases (
  id uuid primary key default gen_random_uuid(),
  payment_reference text not null references public.payment_intents(reference) on delete restrict,
  beneficiary_user_id uuid not null references public.profiles(id) on delete restrict,
  kind text not null check (kind in ('duplicate', 'unapplied', 'other')),
  status text not null default 'open' check (status in ('open', 'credited', 'cash_refund_due', 'cash_refunded', 'declined')),
  contact_note text not null default '' check (length(contact_note) <= 500),
  decision_note text not null default '' check (length(decision_note) <= 1000),
  coins_credited bigint not null default 0 check (coins_credited >= 0),
  credit_tx_id uuid references public.coin_transactions(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id), decided_at timestamptz,
  created_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
create index if not exists refund_cases_reference on public.refund_cases(payment_reference);
alter table public.refund_cases enable row level security;
revoke all on public.refund_cases from anon, authenticated;

create or replace function public.qb_admin_payment_facts(p_query text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare q text := lower(btrim(coalesce(p_query, '')));
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin', 'finance_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if length(q) < 3 then raise exception 'QB_QUERY_TOO_SHORT' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
    select jsonb_build_object(
      'reference', i.reference, 'status', i.status, 'method', i.method, 'amount_minor', i.amount_minor, 'currency', i.currency_code, 'coins', i.coins,
      'plan', i.metadata ->> 'plan', 'created_at', i.created_at, 'settled_at', i.settled_at, 'learner', b.email, 'payer', pa.email,
      'credited', i.credited_tx_id is not null,
      'subscription_granted', exists (select 1 from public.learner_subscriptions s where s.source = 'payment' and s.source_ref = i.reference),
      'coins_spent_after', coalesce((select sum(-t.amount) from public.coin_transactions t join public.wallets w on w.id = t.wallet_id
          where w.user_id = i.beneficiary_user_id and t.kind = 'spend'
            and t.created_at >= coalesce((select ct.created_at from public.coin_transactions ct where ct.id = i.credited_tx_id), i.created_at)), 0),
      'coins_already_returned', coalesce((select sum(t.amount) from public.coin_transactions t where t.payment_intent_id = i.id and t.kind = 'refund'), 0),
      'same_plan_charges_24h', (select count(*) from public.payment_intents o where o.payer_user_id = i.payer_user_id and o.beneficiary_user_id = i.beneficiary_user_id and o.status = 'successful'
          and o.coins = i.coins and coalesce(o.metadata ->> 'plan', '') = coalesce(i.metadata ->> 'plan', '') and o.id <> i.id and abs(extract(epoch from (o.created_at - i.created_at))) <= 86400),
      'days_since_payment', floor(extract(epoch from (now() - i.created_at)) / 86400),
      'within_window', now() - i.created_at <= interval '7 days',
      'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'status', c.status, 'coins_credited', c.coins_credited)) from public.refund_cases c where c.payment_reference = i.reference), '[]'::jsonb)
    ) as x
    from public.payment_intents i join public.profiles b on b.id = i.beneficiary_user_id join public.profiles pa on pa.id = i.payer_user_id
    where lower(i.reference) = q or lower(coalesce(i.provider_reference, '')) = q or lower(b.email) = q or lower(pa.email) = q
    order by i.created_at desc limit 20) y), '[]'::jsonb);
end $fn$;
