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
