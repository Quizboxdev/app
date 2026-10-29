-- QuizBox Affiliates and the commission ledger (Release C-1 of docs/quizbox-transformation/04_IMPLEMENTATION_ROADMAP.md).
-- Adults apply to become affiliates; staff approve them; a customer who arrives through an affiliate's code is attributed to that affiliate (first touch, server side, once);
-- when that customer's FIRST eligible payment settles, a commission is accrued, held for a validation period, then approved; a refund reverses it with an explicit ledger row.
--   commission_policies       versioned rules (rates per tier, the combined acquisition cap, hold days, attribution window, minimum payout, tax share, eligible purposes). A new version is a new row; an approved row never changes.
--   affiliates                one row per applicant: adult attestation, terms, status applied / approved / suspended / rejected / terminated, referral code, tier
--   affiliate_payout_details  where approved commission will be paid (closed to every browser; only a masked value is ever returned)
--   referral_attributions     one row per referred customer, first touch, immutable apart from pending -> qualified / rejected
--   commission_accruals       one row per commission, with gross, tax, net, rate, amount, the part clipped by the cap, and its status pending / approved / payable / paid / reversed
--   commission_ledger         append-only money trail in four buckets (pending, available, reserved, paid); every change is a new row, corrections are explicit reversals
-- Rules built in: direct referrals only, no downline; no self-referral; a customer who already paid cannot be attributed; first purchase only (recurring commissions are switched off by a CHECK, not a setting);
-- nothing accrues unless the payment is settled AND the subscription was actually granted; the combined affiliate + manager share of one sale can never pass the policy cap; a refund reverses the commission
-- (a commission that was already approved or paid becomes a negative available balance that later earnings offset: it never goes into a payout).
-- Everything is off until flags.affiliates is switched on AND a policy version is approved. The pilot policy below is seeded as a DRAFT so no commission can accrue on a guess.
-- Payment arrives through the normal Paystack path; lib/payments/settlement.ts calls qb_commission_accrue / qb_commission_reverse after the existing fulfilment steps.
-- Additive and idempotent. Rollback: supabase/rollback/affiliate_commission_foundation.sql (keeps the records).
begin;

insert into public.platform_settings(key, value, description)
select v.key, v.value::jsonb, v.descr from (values
  ('flags.affiliates', 'false', 'The affiliate programme is open (applications, referral codes, commission accrual)'),
  ('flags.affiliate_payouts', 'false', 'Affiliates may request payouts (reserved for the payout release)')) as v(key, value, descr)
where not exists (select 1 from public.platform_settings p where p.key = v.key and p.scope_type = 'global');

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.commission_policies (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  name text not null check (length(btrim(name)) between 3 and 80),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  is_pilot boolean not null default true,
  tier_rates jsonb not null check (jsonb_typeof(tier_rates) = 'object' and tier_rates ?& array['registered', 'growth', 'ambassador']),
  growth_min_referrals integer not null default 10 check (growth_min_referrals >= 1),
  ambassador_min_referrals integer not null default 30,
  tier_window_days integer not null default 90 check (tier_window_days between 1 and 730),
  acquisition_cap_percent numeric(7, 4) not null default 15 check (acquisition_cap_percent between 0 and 100),
  hold_days integer not null default 30 check (hold_days between 0 and 365),
  attribution_window_days integer not null default 30 check (attribution_window_days between 1 and 365),
  min_payout_minor bigint not null default 5000 check (min_payout_minor >= 0),
  tax_percent numeric(7, 4) not null default 0 check (tax_percent between 0 and 100),
  eligible_purposes text[] not null default array['subscription']::text[] check (cardinality(eligible_purposes) between 1 and 5),
  recurring_enabled boolean not null default false check (recurring_enabled = false),   -- renewal commissions stay off until independently evaluated: turning them on needs a new migration, not a setting
  note text not null default '' check (length(note) <= 500),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id), approved_at timestamptz, retired_at timestamptz,
  check (ambassador_min_referrals > growth_min_referrals)
);

create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 2 and 80),
  phone text not null check (phone ~ '^[0-9+ ]{8,20}$'),
  referral_code text not null unique check (referral_code ~ '^[A-Z0-9]{6,12}$'),
  status text not null default 'applied' check (status in ('applied', 'approved', 'suspended', 'rejected', 'terminated')),
  tier text not null default 'registered' check (tier in ('registered', 'growth', 'ambassador')),
  adult_attested_at timestamptz not null, terms_accepted_at timestamptz not null,
  identity_verified_at timestamptz, decided_by uuid references public.profiles(id), decided_at timestamptz, decision_note text not null default '' check (length(decision_note) <= 500),
  applied_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_payout_details (
  affiliate_id uuid primary key references public.affiliates(id) on delete restrict,
  method text not null check (method in ('mobile_money', 'bank')),
  network text not null check (length(btrim(network)) between 2 and 40),
  account text not null check (account ~ '^[0-9]{6,30}$'),
  account_name text not null check (length(btrim(account_name)) between 2 and 80),
  verified_at timestamptz, verified_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);

create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referred_user_id uuid not null unique references public.profiles(id) on delete restrict,   -- one attribution per customer: the first touch wins
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  code text not null, source text not null default '' check (length(source) <= 60), campaign text not null default '' check (length(campaign) <= 60),
  captured_at timestamptz not null default now(), expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rejected')),
  reject_reason text check (reject_reason is null or length(reject_reason) <= 120),
  qualified_payment_ref text unique,
  check (expires_at > captured_at)
);
create index if not exists referral_attributions_affiliate on public.referral_attributions(affiliate_id, status);

create table if not exists public.commission_accruals (
  id uuid primary key default gen_random_uuid(),
  payment_reference text not null, kind text not null default 'affiliate' check (kind in ('affiliate')),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  attribution_id uuid not null references public.referral_attributions(id) on delete restrict,
  policy_id uuid not null references public.commission_policies(id) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  gross_minor bigint not null check (gross_minor > 0), tax_minor bigint not null check (tax_minor >= 0), net_minor bigint not null check (net_minor > 0),
  tier text not null check (tier in ('registered', 'growth', 'ambassador')), rate_percent numeric(7, 4) not null check (rate_percent between 0 and 100),
  amount_minor bigint not null check (amount_minor > 0), cap_clipped_minor bigint not null default 0 check (cap_clipped_minor >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'payable', 'paid', 'reversed')),
  release_at timestamptz not null, approved_at timestamptz, reversed_at timestamptz, reversal_reason text check (reversal_reason is null or length(reversal_reason) <= 300),
  created_at timestamptz not null default now(),
  unique (payment_reference, kind),
  check (gross_minor = tax_minor + net_minor)
);
create index if not exists commission_accruals_affiliate on public.commission_accruals(affiliate_id, created_at desc);
create index if not exists commission_accruals_release on public.commission_accruals(release_at) where status = 'pending';

create table if not exists public.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  accrual_id uuid references public.commission_accruals(id) on delete restrict,
  kind text not null check (kind in ('accrual', 'release', 'reversal', 'payout_reserved', 'payout_paid', 'adjustment')),
  bucket text not null check (bucket in ('pending', 'available', 'reserved', 'paid')),
  amount_minor bigint not null check (amount_minor <> 0),
  note text not null default '' check (length(note) <= 300),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index if not exists commission_ledger_affiliate on public.commission_ledger(affiliate_id, bucket);
create unique index if not exists commission_ledger_one_step on public.commission_ledger(accrual_id, kind, bucket) where accrual_id is not null and kind in ('accrual', 'release', 'reversal');

alter table public.commission_policies enable row level security; alter table public.affiliates enable row level security; alter table public.affiliate_payout_details enable row level security;
alter table public.referral_attributions enable row level security; alter table public.commission_accruals enable row level security; alter table public.commission_ledger enable row level security;
revoke all on public.commission_policies, public.affiliates, public.affiliate_payout_details, public.referral_attributions, public.commission_accruals, public.commission_ledger from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Immutability: money records are corrected by new rows, never edited
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_cm_guard() returns trigger language plpgsql set search_path = '' as $fn$
begin
  if tg_table_name = 'commission_ledger' then raise exception 'QB_LEDGER_IMMUTABLE' using errcode = '42501'; end if;
  if tg_op = 'DELETE' then raise exception 'QB_RECORD_IMMUTABLE' using errcode = '42501'; end if;
  if tg_table_name = 'commission_policies' then
    if old.status <> 'draft' and (to_jsonb(new) - 'status' - 'retired_at') is distinct from (to_jsonb(old) - 'status' - 'retired_at') then raise exception 'QB_POLICY_IMMUTABLE' using errcode = '42501'; end if;
    if old.status = 'retired' and new.status <> 'retired' then raise exception 'QB_POLICY_IMMUTABLE' using errcode = '42501'; end if;
  elsif tg_table_name = 'referral_attributions' then
    if (new.referred_user_id, new.affiliate_id, new.code, new.captured_at, new.expires_at) is distinct from (old.referred_user_id, old.affiliate_id, old.code, old.captured_at, old.expires_at) then raise exception 'QB_ATTRIBUTION_IMMUTABLE' using errcode = '42501'; end if;
    if old.status <> 'pending' and new.status is distinct from old.status then raise exception 'QB_ATTRIBUTION_IMMUTABLE' using errcode = '42501'; end if;
  elsif tg_table_name = 'commission_accruals' then
    if (new.payment_reference, new.kind, new.affiliate_id, new.attribution_id, new.policy_id, new.currency, new.gross_minor, new.tax_minor, new.net_minor, new.tier, new.rate_percent, new.amount_minor, new.cap_clipped_minor, new.release_at, new.created_at)
       is distinct from (old.payment_reference, old.kind, old.affiliate_id, old.attribution_id, old.policy_id, old.currency, old.gross_minor, old.tax_minor, old.net_minor, old.tier, old.rate_percent, old.amount_minor, old.cap_clipped_minor, old.release_at, old.created_at)
    then raise exception 'QB_ACCRUAL_IMMUTABLE' using errcode = '42501'; end if;
    if old.status = 'reversed' and new.status <> 'reversed' then raise exception 'QB_ACCRUAL_IMMUTABLE' using errcode = '42501'; end if;
  end if;
  return new;
end $fn$;
drop trigger if exists commission_ledger_guard on public.commission_ledger;
create trigger commission_ledger_guard before update or delete on public.commission_ledger for each row execute function public.qb_cm_guard();
drop trigger if exists commission_policies_guard on public.commission_policies;
create trigger commission_policies_guard before update or delete on public.commission_policies for each row execute function public.qb_cm_guard();
drop trigger if exists referral_attributions_guard on public.referral_attributions;
create trigger referral_attributions_guard before update or delete on public.referral_attributions for each row execute function public.qb_cm_guard();
drop trigger if exists commission_accruals_guard on public.commission_accruals;
create trigger commission_accruals_guard before update or delete on public.commission_accruals for each row execute function public.qb_cm_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Money staff: owner, super admin or finance admin.
create or replace function public.qb_cm_is_staff() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and quizbox_core.is_staff(array['super_admin', 'finance_admin']);
$fn$;

-- An adult, active, non-managed account (minors and teacher-managed learners never join a cash programme).
create or replace function public.qb_cm_adult_user(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_user is not null
    and exists (select 1 from public.profiles p where p.id = p_user and lower(p.status::text) = 'active')
    and not exists (select 1 from public.student_profiles sp where sp.user_id = p_user and (sp.is_minor or sp.managed_by is not null));
$fn$;

-- The policy in force: the newest approved version.
create or replace function public.qb_cm_policy() returns public.commission_policies language sql stable security definer set search_path = '' as $fn$
  select * from public.commission_policies where status = 'approved' order by version desc limit 1;
$fn$;

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

commit;
notify pgrst, 'reload schema';
