create or replace function public.qb_commission_admin_summary() returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare pol public.commission_policies;
begin
  if not public.qb_cm_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  perform public.qb_cm_release_holds();
  pol := public.qb_cm_policy();
  return jsonb_build_object('enabled', quizbox_core.flag('flags.affiliates'),
    'policy', case when pol.id is null then null else jsonb_build_object('version', pol.version, 'name', pol.name, 'pilot', pol.is_pilot, 'cap_percent', pol.acquisition_cap_percent, 'hold_days', pol.hold_days) end,
    'affiliates', coalesce((select jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from public.affiliates group by status) s), '{}'::jsonb),
    'balances', coalesce((select jsonb_object_agg(b.bucket, b.total) from (select bucket, sum(amount_minor)::bigint as total from public.commission_ledger group by bucket) b), '{}'::jsonb),
    'accruals', coalesce((select jsonb_object_agg(s.status, jsonb_build_object('count', s.n, 'amount_minor', s.total)) from (select status, count(*) as n, sum(amount_minor)::bigint as total from public.commission_accruals group by status) s), '{}'::jsonb),
    'cap_clipped_minor', coalesce((select sum(cap_clipped_minor)::bigint from public.commission_accruals where status <> 'reversed'), 0),
    'ledger_total_minor', coalesce((select sum(amount_minor)::bigint from public.commission_ledger), 0));
end $fn$;

create or replace function public.qb_commission_admin_accruals(p_status text default null, p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_cm_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'reference', x.payment_reference, 'affiliate', a.display_name, 'tier', x.tier, 'rate_percent', x.rate_percent, 'gross_minor', x.gross_minor, 'tax_minor', x.tax_minor, 'net_minor', x.net_minor,
      'amount_minor', x.amount_minor, 'cap_clipped_minor', x.cap_clipped_minor, 'status', x.status, 'release_at', x.release_at, 'created_at', x.created_at, 'policy_version', pv.version) order by x.created_at desc)
    from (select * from public.commission_accruals where p_status is null or p_status = '' or status = p_status order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x
    join public.affiliates a on a.id = x.affiliate_id join public.commission_policies pv on pv.id = x.policy_id), '[]'::jsonb);
end $fn$;

-- For a refund recorded outside the payment provider's callback (for example a cash refund by hand): reverses the commission on that payment.
create or replace function public.qb_commission_admin_reverse(p_reference text, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r jsonb;
begin
  if not public.qb_cm_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  r := public.qb_commission_reverse(btrim(p_reference), p_reason);
  if r ->> 'outcome' = 'none' then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('commission.reverse', 'commission_accruals', null, jsonb_build_object('reference', p_reference));
  return r;
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function public.qb_affiliate_apply(text, text, boolean, boolean), public.qb_affiliate_me(), public.qb_affiliate_payout_save(text, text, text, text), public.qb_affiliate_summary(), public.qb_referral_capture(text, text, text),
  public.qb_commission_accrue(text), public.qb_commission_reverse(text, text), public.qb_commission_policies_list(),
  public.qb_commission_policy_save(text, jsonb, integer, integer, integer, numeric, integer, integer, bigint, numeric, text[], boolean, text), public.qb_commission_policy_approve(uuid),
  public.qb_affiliate_admin_list(text), public.qb_affiliate_decide(uuid, text, text, boolean), public.qb_commission_admin_summary(), public.qb_commission_admin_accruals(text, integer), public.qb_commission_admin_reverse(text, text)
  from public, anon, authenticated;
grant execute on function public.qb_affiliate_apply(text, text, boolean, boolean), public.qb_affiliate_me(), public.qb_affiliate_payout_save(text, text, text, text), public.qb_affiliate_summary(), public.qb_referral_capture(text, text, text),
  public.qb_commission_policies_list(), public.qb_commission_policy_save(text, jsonb, integer, integer, integer, numeric, integer, integer, bigint, numeric, text[], boolean, text), public.qb_commission_policy_approve(uuid),
  public.qb_affiliate_admin_list(text), public.qb_affiliate_decide(uuid, text, text, boolean), public.qb_commission_admin_summary(), public.qb_commission_admin_accruals(text, integer), public.qb_commission_admin_reverse(text, text) to authenticated;
grant execute on function public.qb_commission_accrue(text), public.qb_commission_reverse(text, text) to service_role;


notify pgrst, 'reload schema';
