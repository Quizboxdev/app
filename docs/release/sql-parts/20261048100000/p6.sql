create or replace function public.qb_commission_policy_save(p_name text, p_tier_rates jsonb, p_growth_min integer, p_ambassador_min integer, p_tier_window_days integer, p_cap numeric, p_hold_days integer,
  p_window_days integer, p_min_payout_minor bigint, p_tax_percent numeric, p_purposes text[], p_pilot boolean, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_ver integer; p public.commission_policies; k text;
begin
  if not public.qb_cm_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if jsonb_typeof(p_tier_rates) <> 'object' or not (p_tier_rates ?& array['registered', 'growth', 'ambassador']) then raise exception 'QB_POLICY_INVALID' using errcode = '22023'; end if;
  foreach k in array array['registered', 'growth', 'ambassador'] loop
    if jsonb_typeof(p_tier_rates -> k) <> 'number' or (p_tier_rates ->> k)::numeric not between 0 and 100 then raise exception 'QB_POLICY_INVALID' using errcode = '22023'; end if;
  end loop;
  select coalesce(max(version), 0) + 1 into v_ver from public.commission_policies;
  begin
    insert into public.commission_policies(version, name, is_pilot, tier_rates, growth_min_referrals, ambassador_min_referrals, tier_window_days, acquisition_cap_percent, hold_days, attribution_window_days, min_payout_minor, tax_percent, eligible_purposes, note, created_by)
    values (v_ver, btrim(p_name), coalesce(p_pilot, true), p_tier_rates, p_growth_min, p_ambassador_min, p_tier_window_days, p_cap, p_hold_days, p_window_days, p_min_payout_minor, p_tax_percent, p_purposes, left(coalesce(p_note, ''), 500), auth.uid()) returning * into p;
  exception when check_violation or not_null_violation or invalid_text_representation then raise exception 'QB_POLICY_INVALID' using errcode = '22023';
  end;
  perform quizbox_core.audit('commission.policy_save', 'commission_policies', p.id, jsonb_build_object('version', p.version));
  return to_jsonb(p);
end $fn$;

-- Approving makes the version live and retires the previous one. A different person must approve it; the owner (super admin) may approve their own, and that is written to the audit trail.
create or replace function public.qb_commission_policy_approve(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare p public.commission_policies; v_self boolean;
begin
  if not public.qb_cm_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into p from public.commission_policies where id = p_id for update;
  if p.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p.status <> 'draft' then raise exception 'QB_NOT_A_DRAFT' using errcode = '22023'; end if;
  v_self := p.created_by is not null and p.created_by = auth.uid();
  if v_self and not quizbox_core.is_staff(array['super_admin']) then raise exception 'QB_SECOND_APPROVER_REQUIRED' using errcode = '42501'; end if;
  update public.commission_policies set status = 'retired', retired_at = now() where status = 'approved';
  update public.commission_policies set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p.id returning * into p;
  perform quizbox_core.audit('commission.policy_approve', 'commission_policies', p.id, jsonb_build_object('version', p.version, 'self_approved', v_self));
  return to_jsonb(p);
end $fn$;

create or replace function public.qb_affiliate_admin_list(p_status text default 'applied') returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_cm_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.display_name, 'email', p.email, 'phone', a.phone, 'status', a.status, 'tier', a.tier, 'code', a.referral_code, 'applied_at', a.applied_at,
      'has_payout_details', exists (select 1 from public.affiliate_payout_details d where d.affiliate_id = a.id), 'payout_verified', exists (select 1 from public.affiliate_payout_details d where d.affiliate_id = a.id and d.verified_at is not null),
      'referrals', (select count(*) from public.referral_attributions r where r.affiliate_id = a.id), 'paid_referrals', (select count(*) from public.referral_attributions r where r.affiliate_id = a.id and r.status = 'qualified')) order by a.applied_at desc)
    from public.affiliates a join public.profiles p on p.id = a.user_id where p_status is null or p_status = '' or a.status = p_status), '[]'::jsonb);
end $fn$;

-- approve (needs identity checked by staff and payout details on file), reject, suspend, reinstate, terminate.
create or replace function public.qb_affiliate_decide(p_id uuid, p_action text, p_note text, p_identity_verified boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare a public.affiliates; v_to text;
begin
  if not public.qb_cm_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into a from public.affiliates where id = p_id for update;
  if a.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_action = 'approve' then
    if a.status <> 'applied' then raise exception 'QB_INVALID_TRANSITION' using errcode = '22023'; end if;
    if not coalesce(p_identity_verified, false) then raise exception 'QB_IDENTITY_CHECK_REQUIRED' using errcode = '22023'; end if;
    if not exists (select 1 from public.affiliate_payout_details d where d.affiliate_id = a.id) then raise exception 'QB_PAYOUT_DETAILS_REQUIRED' using errcode = '22023'; end if;
    if not public.qb_cm_adult_user(a.user_id) then raise exception 'QB_ADULTS_ONLY' using errcode = '42501'; end if;
    v_to := 'approved';
  elsif p_action = 'reject' then
    if a.status <> 'applied' then raise exception 'QB_INVALID_TRANSITION' using errcode = '22023'; end if; v_to := 'rejected';
  elsif p_action = 'suspend' then
    if a.status <> 'approved' then raise exception 'QB_INVALID_TRANSITION' using errcode = '22023'; end if; v_to := 'suspended';
  elsif p_action = 'reinstate' then
    if a.status <> 'suspended' then raise exception 'QB_INVALID_TRANSITION' using errcode = '22023'; end if; v_to := 'approved';
  elsif p_action = 'terminate' then
    if a.status not in ('approved', 'suspended') then raise exception 'QB_INVALID_TRANSITION' using errcode = '22023'; end if; v_to := 'terminated';
  else raise exception 'QB_INVALID_ACTION' using errcode = '22023';
  end if;
  if p_action <> 'approve' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  update public.affiliates set status = v_to, decided_by = auth.uid(), decided_at = now(), decision_note = left(coalesce(p_note, ''), 500), updated_at = now(),
    identity_verified_at = case when p_action = 'approve' then now() else identity_verified_at end where id = a.id returning * into a;
  if p_action = 'approve' then update public.affiliate_payout_details set verified_at = now(), verified_by = auth.uid() where affiliate_id = a.id and verified_at is null; end if;
  perform quizbox_core.audit('affiliate.' || p_action, 'affiliates', a.id, jsonb_build_object('to', v_to));
  perform public.qb_cm_notify(a.user_id, case when v_to = 'approved' then 'You are an affiliate' else 'Your affiliate status changed' end,
    case when v_to = 'approved' then 'Your application was approved. Your referral code is ready on the Affiliate page.' else 'Your affiliate status is now ' || v_to || '.' end, '/affiliate');
  return jsonb_build_object('id', a.id, 'status', a.status);
end $fn$;
