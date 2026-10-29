-- Where commission is paid. Changing the details of an approved affiliate clears their verification, so staff look at them again.
create or replace function public.qb_affiliate_payout_save(p_method text, p_network text, p_account text, p_account_name text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare a public.affiliates;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.affiliates where user_id = auth.uid();
  if a.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.status in ('suspended', 'terminated', 'rejected') then raise exception 'QB_AFFILIATE_BLOCKED' using errcode = '42501'; end if;
  if p_method not in ('mobile_money', 'bank') or length(btrim(coalesce(p_network, ''))) not between 2 and 40 or coalesce(p_account, '') !~ '^[0-9]{6,30}$' or length(btrim(coalesce(p_account_name, ''))) not between 2 and 80 then raise exception 'QB_PAYOUT_INVALID' using errcode = '22023'; end if;
  insert into public.affiliate_payout_details(affiliate_id, method, network, account, account_name) values (a.id, p_method, btrim(p_network), p_account, btrim(p_account_name))
  on conflict (affiliate_id) do update set method = excluded.method, network = excluded.network, account = excluded.account, account_name = excluded.account_name, verified_at = null, verified_by = null, updated_at = now()
    where (public.affiliate_payout_details.method, public.affiliate_payout_details.network, public.affiliate_payout_details.account, public.affiliate_payout_details.account_name) is distinct from (excluded.method, excluded.network, excluded.account, excluded.account_name);
  perform quizbox_core.audit('affiliate.payout_details', 'affiliates', a.id, '{}'::jsonb);
  return public.qb_affiliate_me();
end $fn$;

-- The affiliate's own numbers. Buyers are never identified: only counts, amounts and dates.
create or replace function public.qb_affiliate_summary() returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare a public.affiliates; pol public.commission_policies; bal jsonb; v_recent integer;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.affiliates where user_id = auth.uid();
  if a.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_cm_release_holds();
  pol := public.qb_cm_policy();
  select coalesce(jsonb_object_agg(b.bucket, b.total), '{}'::jsonb) into bal from (select l.bucket, sum(l.amount_minor)::bigint as total from public.commission_ledger l where l.affiliate_id = a.id group by l.bucket) b;
  select count(*) into v_recent from public.commission_accruals x where x.affiliate_id = a.id and x.status <> 'reversed' and x.created_at >= now() - make_interval(days => coalesce(pol.tier_window_days, 90));
  return jsonb_build_object('status', a.status, 'tier', a.tier, 'referral_code', case when a.status = 'approved' then a.referral_code else null end,
    'balances', jsonb_build_object('pending', coalesce((bal ->> 'pending')::bigint, 0), 'available', coalesce((bal ->> 'available')::bigint, 0), 'reserved', coalesce((bal ->> 'reserved')::bigint, 0), 'paid', coalesce((bal ->> 'paid')::bigint, 0)),
    'referrals', jsonb_build_object('signed_up', (select count(*) from public.referral_attributions r where r.affiliate_id = a.id), 'paid', (select count(*) from public.referral_attributions r where r.affiliate_id = a.id and r.status = 'qualified'),
      'in_window', v_recent, 'growth_at', pol.growth_min_referrals, 'ambassador_at', pol.ambassador_min_referrals, 'window_days', pol.tier_window_days),
    'policy', case when pol.id is null then null else jsonb_build_object('version', pol.version, 'hold_days', pol.hold_days, 'min_payout_minor', pol.min_payout_minor, 'rates', pol.tier_rates, 'pilot', pol.is_pilot) end,
    'recent', coalesce((select jsonb_agg(jsonb_build_object('created_at', x.created_at, 'amount_minor', x.amount_minor, 'status', x.status, 'release_at', x.release_at, 'rate_percent', x.rate_percent) order by x.created_at desc)
      from (select * from public.commission_accruals where affiliate_id = a.id order by created_at desc limit 20) x), '[]'::jsonb));
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Referral capture (called for the signed-in customer who arrived with a code)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_referral_capture(p_code text, p_source text default '', p_campaign text default '') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')); a public.affiliates; pol public.commission_policies; r public.referral_attributions; v_days integer;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not quizbox_core.flag('flags.affiliates') then return jsonb_build_object('outcome', 'programme_off'); end if;
  perform quizbox_private.enforce_budget('qb_referral_capture', 20, 3600);                                  -- a person cannot guess codes: 20 tries an hour
  if v_code !~ '^[A-Z0-9]{6,12}$' then return jsonb_build_object('outcome', 'invalid_code'); end if;
  select * into a from public.affiliates where referral_code = v_code;
  if a.id is null or a.status <> 'approved' then return jsonb_build_object('outcome', 'invalid_code'); end if;
  if a.user_id = auth.uid() then
    perform quizbox_core.audit('referral.self_referral', 'affiliates', a.id, '{}'::jsonb);
    return jsonb_build_object('outcome', 'self_referral');
  end if;
  select * into r from public.referral_attributions where referred_user_id = auth.uid();
  if r.id is not null then return jsonb_build_object('outcome', 'already_attributed'); end if;
  if exists (select 1 from public.payment_intents i where (i.payer_user_id = auth.uid() or i.beneficiary_user_id = auth.uid()) and i.status in ('successful', 'refunded', 'reversed')) then return jsonb_build_object('outcome', 'existing_customer'); end if;
  pol := public.qb_cm_policy(); v_days := coalesce(pol.attribution_window_days, 30);
  insert into public.referral_attributions(referred_user_id, affiliate_id, code, source, campaign, expires_at)
  values (auth.uid(), a.id, v_code, left(btrim(coalesce(p_source, '')), 60), left(btrim(coalesce(p_campaign, '')), 60), now() + make_interval(days => v_days))
  on conflict (referred_user_id) do nothing returning * into r;
  if r.id is null then return jsonb_build_object('outcome', 'already_attributed'); end if;
  return jsonb_build_object('outcome', 'attributed', 'expires_at', r.expires_at);
end $fn$;
