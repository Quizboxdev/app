create or replace function public.qb_cm_notify(p_user uuid, p_title text, p_message text, p_link text) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  begin
    execute 'insert into public.notifications(recipient_user_id, recipient_profile_id, recipient_email, recipient_role, type, title, message, link, category) select p.id, p.id, p.email, p.role, $1, $2, $3, $4, $5 from public.profiles p where p.id = $6'
      using 'affiliate', left(p_title, 120), left(p_message, 300), p_link, 'system', p_user;
  exception when others then null;   -- a notice must never undo the money
  end;
end $fn$;

-- The tier a sale earns at: the affiliate's verified paid direct referrals inside the policy window, before this one.
create or replace function public.qb_cm_tier(p_affiliate uuid, p_policy_id uuid) returns text language plpgsql stable security definer set search_path = '' as $fn$
declare pol public.commission_policies; n integer;
begin
  select * into pol from public.commission_policies where id = p_policy_id;
  select count(*) into n from public.commission_accruals a where a.affiliate_id = p_affiliate and a.status <> 'reversed' and a.created_at >= now() - make_interval(days => pol.tier_window_days);
  return case when n >= pol.ambassador_min_referrals then 'ambassador' when n >= pol.growth_min_referrals then 'growth' else 'registered' end;
end $fn$;

-- Moves held commissions whose validation period is over from pending to available (idempotent; safe to call from anywhere).
create or replace function public.qb_cm_release_holds() returns integer language plpgsql security definer set search_path = '' as $fn$
declare r public.commission_accruals; n integer := 0; g uuid;
begin
  for r in select * from public.commission_accruals where status = 'pending' and release_at <= now() order by release_at for update skip locked loop
    g := gen_random_uuid();
    update public.commission_accruals set status = 'approved', approved_at = now() where id = r.id;
    insert into public.commission_ledger(group_id, affiliate_id, accrual_id, kind, bucket, amount_minor, note) values
      (g, r.affiliate_id, r.id, 'release', 'pending', -r.amount_minor, 'Validation period over'),
      (g, r.affiliate_id, r.id, 'release', 'available', r.amount_minor, 'Validation period over');
    n := n + 1;
  end loop;
  return n;
end $fn$;

revoke all on function public.qb_cm_guard(), public.qb_cm_is_staff(), public.qb_cm_adult_user(uuid), public.qb_cm_policy(), public.qb_cm_notify(uuid, text, text, text), public.qb_cm_tier(uuid, uuid), public.qb_cm_release_holds() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Pilot policy (DRAFT: nothing accrues until staff approve a version)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
insert into public.commission_policies(version, name, status, is_pilot, tier_rates, note)
select 1, 'Pilot policy v1 (proposed)', 'draft', true, '{"registered": 10, "growth": 12.5, "ambassador": 15}'::jsonb,
  'Proposed pilot values from the commercial plan: 10 / 12.5 / 15 percent, 30-day hold, 30-day attribution, 15 percent combined cap, GHS 50 minimum payout, tax share 0 until decided. Not live policy.'
where not exists (select 1 from public.commission_policies);

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Affiliate (the signed-in adult)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_affiliate_apply(p_display_name text, p_phone text, p_adult boolean, p_accept_terms boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare a public.affiliates; v_code text; v_try integer := 0;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not quizbox_core.flag('flags.affiliates') then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  perform quizbox_private.enforce_budget('qb_affiliate_apply', 10, 3600);
  if not public.qb_cm_adult_user(auth.uid()) then raise exception 'QB_ADULTS_ONLY' using errcode = '42501'; end if;
  if not coalesce(p_adult, false) then raise exception 'QB_ADULT_ATTESTATION_REQUIRED' using errcode = '22023'; end if;
  if not coalesce(p_accept_terms, false) then raise exception 'QB_TERMS_REQUIRED' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_display_name, ''))) not between 2 and 80 or coalesce(p_phone, '') !~ '^[0-9+ ]{8,20}$' then raise exception 'QB_AFFILIATE_INVALID' using errcode = '22023'; end if;
  select * into a from public.affiliates where user_id = auth.uid();
  if a.id is not null then
    if a.status in ('suspended', 'terminated') then raise exception 'QB_AFFILIATE_BLOCKED' using errcode = '42501'; end if;
    if a.status in ('applied', 'rejected') then
      update public.affiliates set display_name = btrim(p_display_name), phone = btrim(p_phone), status = 'applied', updated_at = now() where id = a.id returning * into a;
    end if;
  else
    loop
      v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8)); v_try := v_try + 1;
      begin
        insert into public.affiliates(user_id, display_name, phone, referral_code, adult_attested_at, terms_accepted_at)
        values (auth.uid(), btrim(p_display_name), btrim(p_phone), v_code, now(), now()) returning * into a;
        exit;
      exception when unique_violation then
        if v_try >= 5 then raise; end if;
        select * into a from public.affiliates where user_id = auth.uid();
        if a.id is not null then exit; end if;
      end;
    end loop;
    perform quizbox_core.audit('affiliate.apply', 'affiliates', a.id, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', a.id, 'status', a.status);
end $fn$;

create or replace function public.qb_affiliate_me() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare a public.affiliates; d public.affiliate_payout_details;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.affiliates where user_id = auth.uid();
  if a.id is null then return jsonb_build_object('enabled', quizbox_core.flag('flags.affiliates'), 'applied', false); end if;
  select * into d from public.affiliate_payout_details where affiliate_id = a.id;
  return jsonb_build_object('enabled', quizbox_core.flag('flags.affiliates'), 'applied', true, 'id', a.id, 'status', a.status, 'tier', a.tier, 'display_name', a.display_name, 'phone', a.phone, 'decision_note', a.decision_note,
    'referral_code', case when a.status = 'approved' then a.referral_code else null end,
    'payout', case when d.affiliate_id is null then null else jsonb_build_object('method', d.method, 'network', d.network, 'account_masked', repeat('*', greatest(length(d.account) - 4, 0)) || right(d.account, 4), 'account_name', d.account_name, 'verified', d.verified_at is not null) end);
end $fn$;
