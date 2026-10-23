-- Refund cases and the owner's Coin-credit tool (the refund policy at /refunds, decided 2026-10-23).
--   qb_admin_payment_facts(query)   finds payments by reference, Paystack reference or email and shows what the policy needs: credited? plan granted? Coins spent since? duplicates? inside 7 days?
--   qb_admin_refund_credit(...)     credits the extra Coins of a duplicate charge back to the buyer (kind "refund", purchased bucket), once per case, never more than the payment
--   qb_admin_refund_case_save(...)  records a request and its outcome; a cash refund may only be recorded when none of the purchase's Coins were used, inside 7 days
--   qb_admin_refund_cases(limit)    the list of cases
-- Owner and finance admins only (the checks are inside each function). A case row is never edited by a browser. Additive and idempotent. Rollback: supabase/rollback/refund_cases.sql.
begin;

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

-- A duplicate charge is returned as Coins, never as cash: the extra amount goes to the buyer's purchased Coins, once per case, and never more than the payment itself.
create or replace function public.qb_admin_refund_credit(p_reference text, p_coins integer, p_reason text, p_case uuid default null, p_override boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare i public.payment_intents; c public.refund_cases; t public.coin_transactions; v_returned bigint; v_key text;
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin', 'finance_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  select * into i from public.payment_intents where reference = btrim(coalesce(p_reference, '')) for update;
  if i.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_case is not null then
    select * into c from public.refund_cases where id = p_case and payment_reference = i.reference for update;
    if c.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
    if c.status = 'credited' then   -- the same case again (a double click or a retry) returns what was done and changes nothing
      return jsonb_build_object('ok', true, 'replayed', true, 'case', c.id, 'transaction', c.credit_tx_id, 'coins', c.coins_credited);
    end if;
  end if;
  if i.status <> 'successful' then raise exception 'QB_PAYMENT_NOT_SETTLED' using errcode = '55000'; end if;
  if p_coins is null or p_coins < 1 or p_coins > i.coins then raise exception 'QB_INVALID_AMOUNT' using errcode = '22023'; end if;
  if now() - i.created_at > interval '7 days' and not coalesce(p_override, false) then raise exception 'QB_OUTSIDE_WINDOW' using errcode = '55000'; end if;
  select coalesce(sum(amount), 0) into v_returned from public.coin_transactions where payment_intent_id = i.id and kind = 'refund';
  if v_returned + p_coins > i.coins then raise exception 'QB_EXCEEDS_PAYMENT' using errcode = '55000'; end if;
  if c.id is null then
    insert into public.refund_cases(payment_reference, beneficiary_user_id, kind, created_by) values (i.reference, i.beneficiary_user_id, 'duplicate', auth.uid()) returning * into c;
  end if;
  v_key := 'refund-credit:' || c.id::text;
  t := quizbox_core.post_coin(quizbox_core.ensure_wallet(i.beneficiary_user_id), 'purchased', p_coins, 'refund', v_key, i.id, left(btrim(p_reason), 300), auth.uid(),
         jsonb_build_object('case', c.id, 'reference', i.reference, 'override', coalesce(p_override, false)));
  update public.refund_cases set status = 'credited', kind = 'duplicate', coins_credited = p_coins, credit_tx_id = t.id, decision_note = left(btrim(p_reason), 1000),
         decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = c.id;
  perform quizbox_core.audit('refund.credit', 'refund_cases', c.id, jsonb_build_object('reference', i.reference, 'coins', p_coins, 'override', coalesce(p_override, false)));
  begin   -- the buyer is told in the app; a failure here must never undo the credit
    execute 'insert into public.notifications(recipient_user_id, recipient_profile_id, recipient_email, recipient_role, type, title, message, link, category) select p.id, p.id, p.email, p.role, $1, $2, $3, $4, $5 from public.profiles p where p.id = $6'
      using 'refund_credit', 'Coins added to your account', p_coins::text || ' Coins were added to your account for the duplicate charge on payment ' || i.reference || '.', '/subscribe', 'payment', i.beneficiary_user_id;
  exception when others then null;
  end;
  return jsonb_build_object('ok', true, 'replayed', false, 'case', c.id, 'transaction', t.id, 'coins', p_coins, 'balance_after', t.balance_after);
end $fn$;

-- Records a request and its outcome. A cash refund can only be recorded under the policy: inside 7 days, and none of the purchase's Coins used.
create or replace function public.qb_admin_refund_case_save(p_reference text, p_kind text, p_status text, p_note text, p_case uuid default null, p_override boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare i public.payment_intents; c public.refund_cases; v_spent bigint;
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin', 'finance_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_kind not in ('duplicate', 'unapplied', 'other') or p_status not in ('open', 'cash_refund_due', 'cash_refunded', 'declined') then raise exception 'QB_INVALID_CASE' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  select * into i from public.payment_intents where reference = btrim(coalesce(p_reference, '')) for update;
  if i.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_status in ('cash_refund_due', 'cash_refunded') then
    if now() - i.created_at > interval '7 days' and not coalesce(p_override, false) then raise exception 'QB_OUTSIDE_WINDOW' using errcode = '55000'; end if;
    select coalesce(sum(-t.amount), 0) into v_spent from public.coin_transactions t join public.wallets w on w.id = t.wallet_id
      where w.user_id = i.beneficiary_user_id and t.kind = 'spend' and t.created_at >= coalesce((select ct.created_at from public.coin_transactions ct where ct.id = i.credited_tx_id), i.created_at);
    if v_spent > 0 or exists (select 1 from public.learner_subscriptions s where s.source = 'payment' and s.source_ref = i.reference) then raise exception 'QB_COINS_ALREADY_USED' using errcode = '55000'; end if;
  end if;
  if p_case is null then
    insert into public.refund_cases(payment_reference, beneficiary_user_id, kind, status, contact_note, decision_note, created_by, decided_by, decided_at)
    values (i.reference, i.beneficiary_user_id, p_kind, p_status, case when p_status = 'open' then left(btrim(p_note), 500) else '' end,
            case when p_status = 'open' then '' else left(btrim(p_note), 1000) end, auth.uid(), case when p_status = 'open' then null else auth.uid() end, case when p_status = 'open' then null else now() end) returning * into c;
  else
    select * into c from public.refund_cases where id = p_case and payment_reference = i.reference for update;
    if c.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
    if c.status = 'credited' then raise exception 'QB_CASE_CLOSED' using errcode = '55000'; end if;
    update public.refund_cases set kind = p_kind, status = p_status, decision_note = case when p_status = 'open' then decision_note else left(btrim(p_note), 1000) end,
           contact_note = case when p_status = 'open' then left(btrim(p_note), 500) else contact_note end,
           decided_by = case when p_status = 'open' then null else auth.uid() end, decided_at = case when p_status = 'open' then null else now() end, updated_at = now()
     where id = c.id returning * into c;
  end if;
  perform quizbox_core.audit('refund.case', 'refund_cases', c.id, jsonb_build_object('reference', i.reference, 'kind', p_kind, 'status', p_status));
  return to_jsonb(c) - 'created_by';
end $fn$;

create or replace function public.qb_admin_refund_cases(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_core.is_staff(array['super_admin', 'finance_admin']) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'requested_at' desc) from (
    select jsonb_build_object('id', c.id, 'reference', c.payment_reference, 'learner', b.email, 'kind', c.kind, 'status', c.status, 'coins_credited', c.coins_credited,
      'contact_note', c.contact_note, 'decision_note', c.decision_note, 'requested_at', c.requested_at, 'decided_at', c.decided_at) as x
    from public.refund_cases c join public.profiles b on b.id = c.beneficiary_user_id order by c.requested_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) y), '[]'::jsonb);
end $fn$;

revoke all on function public.qb_admin_payment_facts(text), public.qb_admin_refund_credit(text, integer, text, uuid, boolean), public.qb_admin_refund_case_save(text, text, text, text, uuid, boolean), public.qb_admin_refund_cases(integer) from public, anon, authenticated;
grant execute on function public.qb_admin_payment_facts(text), public.qb_admin_refund_credit(text, integer, text, uuid, boolean), public.qb_admin_refund_case_save(text, text, text, text, uuid, boolean), public.qb_admin_refund_cases(integer) to authenticated;

commit;
notify pgrst, 'reload schema';
