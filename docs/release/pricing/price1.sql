-- The price list: one admin-managed table of everything QuizBox sells (learner plans, school plans, sponsor and company quiz tiers, free tiers), each with a price in pesewas and an optional
-- payment-gateway link. The admin sets the price and pastes the gateway's checkout link; the pricing page and the in-app cards show the active rows, and a click goes to the link.
-- A price left empty shows "Price to be announced". Rows are retired (made inactive), never deleted, so history keeps its meaning. Seeded once with unpriced starter rows.
-- Additive and idempotent. Rollback: supabase/rollback/price_list.sql.

create table if not exists public.price_list (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{3,60}$'),
  kind text not null default 'plan' check (kind in ('plan','campaign','bundle','addon')),
  name text not null check (length(btrim(name)) between 2 and 80),
  audience text not null check (audience in ('learner','teacher','school','host','sponsor','company','other')),
  description text not null default '' check (length(description) <= 300),
  includes jsonb not null default '[]'::jsonb check (jsonb_typeof(includes) = 'array' and jsonb_array_length(includes) <= 12),
  period text not null default 'month' check (period in ('month','term','year','campaign','once','free')),
  price_minor integer check (price_minor is null or price_minor between 0 and 100000000),
  currency text not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  checkout_url text check (checkout_url is null or (length(checkout_url) <= 500 and checkout_url ~ '^https://[^\s/]+\.[^\s/]+[^\s]*$')),
  highlight boolean not null default false,
  active boolean not null default false,
  starts_at timestamptz, ends_at timestamptz,
  sort_order integer not null default 100,
  grants jsonb not null default '{}'::jsonb check (jsonb_typeof(grants) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists price_list_audience on public.price_list(audience, sort_order);
alter table public.price_list enable row level security;
revoke all on public.price_list from anon, authenticated, public;

create or replace function public.qb_price_admin() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active' and (
    lower(p.role::text) in ('owner','admin') or exists (select 1 from public.user_capabilities c where c.user_id = auth.uid() and c.active and c.capability in ('super_admin','finance_admin'))));
$fn$;

-- What visitors see: active rows inside their sale window. The payment link is shown only when a price is set.
create or replace function public.qb_price_list() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'kind', p.kind, 'name', p.name, 'audience', p.audience, 'description', p.description, 'includes', p.includes, 'period', p.period,
         'price_minor', p.price_minor, 'currency', p.currency, 'highlight', p.highlight, 'checkout_url', case when p.price_minor is not null and p.price_minor > 0 then p.checkout_url end) order by p.sort_order, p.name), '[]'::jsonb)
    from public.price_list p where p.active and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now());
$fn$;

create or replace function public.qb_price_list_admin() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_price_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p) - 'updated_by' order by p.audience, p.sort_order, p.name) from public.price_list p), '[]'::jsonb);
end $fn$;

-- Create or change one row by its code. Only the fields sent are changed on an existing row.
