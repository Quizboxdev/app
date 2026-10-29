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
create or replace function public.qb_price_save(p_code text, p_row jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k text; r public.price_list; v_code text := lower(btrim(p_code)); inc jsonb;
begin
  if not public.qb_price_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if jsonb_typeof(p_row) <> 'object' then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_row) loop
    if k not in ('kind','name','audience','description','includes','period','price_minor','currency','checkout_url','highlight','active','starts_at','ends_at','sort_order','grants') then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  end loop;
  if p_row ? 'includes' then
    inc := p_row->'includes';
    if jsonb_typeof(inc) <> 'array' or exists (select 1 from jsonb_array_elements(inc) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 120) then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
  end if;
  select * into r from public.price_list where code = v_code;
  if not found then
    if not (p_row ? 'name' and p_row ? 'audience') then raise exception 'INVALID_PRICE' using errcode = '22023'; end if;
    insert into public.price_list(code, name, audience, updated_by) values (v_code, btrim(p_row->>'name'), p_row->>'audience', auth.uid()) returning * into r;
  end if;
  update public.price_list set
    kind = coalesce(p_row->>'kind', kind), name = coalesce(nullif(btrim(p_row->>'name'), ''), name), audience = coalesce(p_row->>'audience', audience),
    description = coalesce(left(p_row->>'description', 300), description), includes = coalesce(p_row->'includes', includes), period = coalesce(p_row->>'period', period),
    price_minor = case when p_row ? 'price_minor' then (p_row->>'price_minor')::integer else price_minor end,
    currency = coalesce(upper(p_row->>'currency'), currency),
    checkout_url = case when p_row ? 'checkout_url' then nullif(btrim(p_row->>'checkout_url'), '') else checkout_url end,
    highlight = coalesce((p_row->>'highlight')::boolean, highlight), active = coalesce((p_row->>'active')::boolean, active),
    starts_at = case when p_row ? 'starts_at' then (p_row->>'starts_at')::timestamptz else starts_at end, ends_at = case when p_row ? 'ends_at' then (p_row->>'ends_at')::timestamptz else ends_at end,
    sort_order = coalesce((p_row->>'sort_order')::integer, sort_order), grants = coalesce(p_row->'grants', grants), updated_at = now(), updated_by = auth.uid()
   where id = r.id returning * into r;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), 'price_saved', 'price_list', r.id, 'ok',
    jsonb_build_object('code', r.code, 'price_minor', r.price_minor, 'active', r.active, 'has_link', r.checkout_url is not null));
  return to_jsonb(r) - 'updated_by';
end $fn$;
