create table if not exists public.mk_ledger (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.mk_sellers(id) on delete restrict,
  kind text not null check (kind in ('sale', 'reversal', 'adjustment', 'payout_reserved', 'payout_released')),
  amount_minor bigint not null check (amount_minor <> 0),
  purchase_id uuid references public.mk_purchases(id) on delete restrict,
  payout_id uuid references public.mk_payouts(id) on delete restrict,
  available_at timestamptz not null default now(),
  note text not null default '' check (length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists mk_ledger_seller on public.mk_ledger(seller_id, available_at);
create unique index if not exists mk_ledger_one_sale on public.mk_ledger(purchase_id) where kind = 'sale';
create unique index if not exists mk_ledger_one_reversal on public.mk_ledger(purchase_id) where kind = 'reversal';

create table if not exists public.mk_attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.mk_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  correct integer not null check (correct >= 0), total integer not null check (total >= 1 and correct <= total),
  created_at timestamptz not null default now()
);
create index if not exists mk_attempts_user on public.mk_attempts(user_id, item_id, created_at desc);

alter table public.mk_sellers enable row level security; alter table public.mk_items enable row level security; alter table public.mk_questions enable row level security;
alter table public.mk_purchases enable row level security; alter table public.mk_payouts enable row level security; alter table public.mk_ledger enable row level security; alter table public.mk_attempts enable row level security;
revoke all on public.mk_sellers, public.mk_items, public.mk_questions, public.mk_purchases, public.mk_payouts, public.mk_ledger, public.mk_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_num(p_key text, p_default numeric) returns numeric language sql stable security definer set search_path = '' as $fn$
  select coalesce(nullif(quizbox_core.setting(p_key) #>> '{}', '')::numeric, p_default);
$fn$;

-- Staff: 'review' = owner, admin, super admin or content admin; 'finance' = owner, super admin or finance admin (money).
create or replace function public.qb_mk_is_staff(p_kind text) returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and (
    case when p_kind = 'finance' then quizbox_core.is_staff(array['super_admin', 'finance_admin'])
         else exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active' and upper(p.role::text) in ('ADMIN', 'OWNER')) or quizbox_core.is_staff(array['super_admin', 'content_admin']) end);
$fn$;

-- The sale split in pesewas: the teacher's share is rounded down, QuizBox keeps the rest, so the two always add up to the price.
create or replace function public.qb_mk_split(p_price bigint) returns bigint[] language sql stable security definer set search_path = '' as $fn$
  select array[floor(p_price * public.qb_mk_num('marketplace.seller_share_percent', 60) / 100)::bigint, p_price - floor(p_price * public.qb_mk_num('marketplace.seller_share_percent', 60) / 100)::bigint];
$fn$;

-- 24 hours on working days (Monday to Friday, Ghana time is UTC): a weekend request is counted from Monday, and a due time that lands on a weekend moves to Monday 17:00.
create or replace function public.qb_mk_due_at(p_from timestamptz) returns timestamptz language plpgsql stable set search_path = '' as $fn$
declare d timestamptz := p_from;
begin
  if extract(isodow from d) = 6 then d := date_trunc('day', d) + interval '2 days'; elsif extract(isodow from d) = 7 then d := date_trunc('day', d) + interval '1 day'; end if;
  d := d + interval '24 hours';
  if extract(isodow from d) = 6 then d := date_trunc('day', d) + interval '2 days 17 hours'; elsif extract(isodow from d) = 7 then d := date_trunc('day', d) + interval '1 day 17 hours'; end if;
  return d;
end $fn$;

create or replace function public.qb_mk_notify(p_user uuid, p_title text, p_message text, p_link text) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  begin
    execute 'insert into public.notifications(recipient_user_id, recipient_profile_id, recipient_email, recipient_role, type, title, message, link, category) select p.id, p.id, p.email, p.role, $1, $2, $3, $4, $5 from public.profiles p where p.id = $6'
      using 'marketplace', left(p_title, 120), left(p_message, 300), p_link, 'system', p_user;
  exception when others then null;   -- a notice must never undo the money
  end;
end $fn$;

create or replace function public.qb_mk_my_seller() returns public.mk_sellers language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into s from public.mk_sellers where user_id = auth.uid();
  if s.id is null then raise exception 'QB_NOT_A_SELLER' using errcode = '42501'; end if;
  return s;
end $fn$;
revoke all on function public.qb_mk_num(text, numeric), public.qb_mk_is_staff(text), public.qb_mk_split(bigint), public.qb_mk_due_at(timestamptz), public.qb_mk_notify(uuid, text, text, text), public.qb_mk_my_seller() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Seller
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_seller_get() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into s from public.mk_sellers where user_id = auth.uid();
  if s.id is null then return null; end if;
  return jsonb_build_object('id', s.id, 'display_name', s.display_name, 'school_name', s.school_name, 'phone', s.phone, 'payout_method', s.payout_method, 'payout_network', s.payout_network,
    'payout_account_masked', repeat('*', greatest(length(s.payout_account) - 4, 0)) || right(s.payout_account, 4), 'payout_account_name', s.payout_account_name, 'status', s.status, 'review_note', s.review_note,
    'terms_accepted', s.terms_accepted_at is not null, 'enabled', quizbox_core.flag('flags.marketplace'));
end $fn$;

-- Becoming a seller (teachers only). Changing where the money goes sends a verified seller back to "pending" so staff look at it again.
