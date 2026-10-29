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
