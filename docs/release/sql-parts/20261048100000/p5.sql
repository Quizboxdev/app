-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Commission accrual and reversal (service role: called after a verified payment is fulfilled or refunded)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_commission_accrue(p_reference text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare i public.payment_intents; pol public.commission_policies; r public.referral_attributions; a public.affiliates; v_purpose text; v_tax bigint; v_net bigint; v_tier text; v_rate numeric; v_raw bigint; v_cap bigint; v_existing bigint; v_amount bigint; v_acc public.commission_accruals; v_t timestamptz;
begin
  select * into i from public.payment_intents where reference = p_reference for update;
  if i.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if i.status <> 'successful' or i.credited_tx_id is null then return jsonb_build_object('outcome', 'not_settled'); end if;
  if exists (select 1 from public.commission_accruals where payment_reference = p_reference and kind = 'affiliate') then return jsonb_build_object('outcome', 'already_accrued'); end if;
  if not quizbox_core.flag('flags.affiliates') then return jsonb_build_object('outcome', 'programme_off'); end if;
  pol := public.qb_cm_policy();
  if pol.id is null then return jsonb_build_object('outcome', 'no_approved_policy'); end if;
  v_purpose := coalesce(i.metadata ->> 'purpose', case when i.metadata ? 'plan' then 'subscription' else 'coins' end);
  if not (v_purpose = any (pol.eligible_purposes)) then return jsonb_build_object('outcome', 'not_eligible'); end if;
  if v_purpose = 'subscription' and not exists (select 1 from public.learner_subscriptions s where s.source = 'payment' and s.source_ref = p_reference and s.status = 'active') then return jsonb_build_object('outcome', 'not_fulfilled'); end if;
  select * into r from public.referral_attributions where referred_user_id = i.payer_user_id for update;
  if r.id is null then return jsonb_build_object('outcome', 'no_attribution'); end if;
  if r.status = 'qualified' then return jsonb_build_object('outcome', 'not_first_purchase'); end if;
  if r.status = 'rejected' then return jsonb_build_object('outcome', 'attribution_rejected'); end if;
  v_t := coalesce(i.settled_at, now());
  if v_t > r.expires_at or v_t < r.captured_at then
    update public.referral_attributions set status = 'rejected', reject_reason = 'attribution window over' where id = r.id;
    return jsonb_build_object('outcome', 'attribution_expired');
  end if;
  select * into a from public.affiliates where id = r.affiliate_id;
  if a.id is null or a.status <> 'approved' then return jsonb_build_object('outcome', 'affiliate_not_active'); end if;
  if a.user_id in (i.payer_user_id, i.beneficiary_user_id) then
    update public.referral_attributions set status = 'rejected', reject_reason = 'self referral' where id = r.id;
    perform quizbox_core.audit('referral.self_referral', 'commission_accruals', a.id, jsonb_build_object('reference', p_reference));
    return jsonb_build_object('outcome', 'self_referral');
  end if;
  v_tax := round(i.amount_minor * pol.tax_percent / (100 + pol.tax_percent));
  v_net := i.amount_minor - v_tax;
  v_tier := public.qb_cm_tier(a.id, pol.id);
  v_rate := (pol.tier_rates ->> v_tier)::numeric;
  v_raw := floor(v_net * v_rate / 100)::bigint;
  v_cap := floor(v_net * pol.acquisition_cap_percent / 100)::bigint;
  select coalesce(sum(x.amount_minor), 0) into v_existing from public.commission_accruals x where x.payment_reference = p_reference and x.status <> 'reversed';
  v_amount := least(v_raw, greatest(v_cap - v_existing, 0));
  update public.referral_attributions set status = 'qualified', qualified_payment_ref = p_reference where id = r.id;
  update public.affiliates set tier = v_tier, updated_at = now() where id = a.id and tier is distinct from v_tier;
  if v_amount <= 0 then return jsonb_build_object('outcome', 'nothing_due'); end if;
  insert into public.commission_accruals(payment_reference, affiliate_id, attribution_id, policy_id, currency, gross_minor, tax_minor, net_minor, tier, rate_percent, amount_minor, cap_clipped_minor, release_at)
  values (p_reference, a.id, r.id, pol.id, i.currency_code, i.amount_minor, v_tax, v_net, v_tier, v_rate, v_amount, v_raw - v_amount, v_t + make_interval(days => pol.hold_days)) returning * into v_acc;
  insert into public.commission_ledger(affiliate_id, accrual_id, kind, bucket, amount_minor, note) values (a.id, v_acc.id, 'accrual', 'pending', v_amount, 'Commission on a paid subscription');
  perform public.qb_cm_notify(a.user_id, 'A referral subscribed', 'Someone you referred has subscribed. Your commission of GHS ' || (v_amount / 100.0)::numeric(12, 2)::text || ' is held until the validation period ends.', '/affiliate');
  return jsonb_build_object('outcome', 'accrued', 'accrual', v_acc.id, 'amount_minor', v_amount, 'cap_clipped_minor', v_raw - v_amount, 'tier', v_tier, 'rate_percent', v_rate);
end $fn$;

-- A refund or reversal takes the commission back with an explicit ledger row. If it was already approved or paid, the available balance goes negative and later earnings offset it.
create or replace function public.qb_commission_reverse(p_reference text, p_reason text default 'refunded') returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare x public.commission_accruals; n integer := 0; v_user uuid;
begin
  for x in select * from public.commission_accruals where payment_reference = p_reference and status <> 'reversed' for update loop
    insert into public.commission_ledger(affiliate_id, accrual_id, kind, bucket, amount_minor, note)
    values (x.affiliate_id, x.id, 'reversal', case when x.status = 'pending' then 'pending' else 'available' end, -x.amount_minor, left('Reversed: ' || coalesce(nullif(btrim(p_reason), ''), 'refunded'), 280));
    update public.commission_accruals set status = 'reversed', reversed_at = now(), reversal_reason = left(coalesce(nullif(btrim(p_reason), ''), 'refunded'), 300) where id = x.id;
    select user_id into v_user from public.affiliates where id = x.affiliate_id;
    perform public.qb_cm_notify(v_user, 'A commission was reversed', 'A referred payment was refunded, so the commission for it was taken back.', '/affiliate');
    n := n + 1;
  end loop;
  return jsonb_build_object('outcome', case when n = 0 then 'none' else 'reversed' end, 'reversed', n);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Staff (owner, super admin, finance admin; the check is inside each function)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_commission_policies_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_cm_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.version desc) from public.commission_policies p), '[]'::jsonb);
end $fn$;
