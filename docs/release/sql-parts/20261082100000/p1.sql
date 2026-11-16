-- Family workspace, phases 6 and 7: a parent buys Coins or subscriptions for the children they tick, in ONE checkout, and each child gets their own entitlement.
-- Each ticked child gets their own ordinary payment intent (so the existing wallet ledger, minimum charge, replay protection and subscription fulfilment are used unchanged); the order ties them to one
-- Paystack charge for the total. Settlement is all or nothing: the charge is verified by the existing signed webhook, then every child's intent is credited in one transaction, or none is.
--   public.qb_family_order_create(kind, items, idem)   the parent's order for ticked children: kind 'coins' or 'subscription'; items [{student_id, coins}]; checks each child's permission; returns the order reference and total
--   public.qb_family_order_apply(...)                  service role only: a verified payment event for an order reference (the webhook and the return page both call it); one event settles it exactly once
--   public.qb_family_order_fulfil(reference)           service role only: grants the subscriptions of a paid order (idempotent)
--   public.qb_family_order_revoke(reference, reason)   service role only: takes a refunded order's subscriptions back
--   public.qb_family_order_get(reference) / qb_family_orders()   the parent's own orders and what each child received
--   public.qb_family_wallets()                         each linked child's Coin balance and current subscription, for children the parent may follow
-- Plans and prices are never taken from the browser: the server route computes them from the admin price list and the unit price and compares them with the total this function returns.
-- Off with the rest of the workspace (flags.family_workspace). Errors: QB_AUTH_REQUIRED, QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN, QB_FAMILY_INVALID. Additive and idempotent. Rollback: supabase/rollback/family_orders.sql

create table if not exists public.family_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('QBF-' || replace(gen_random_uuid()::text, '-', '')),
  parent_user_id uuid not null references public.profiles(id),
  workspace_id uuid not null references public.family_workspaces(id),
  kind text not null check (kind in ('coins', 'subscription')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  total_minor bigint not null default 0 check (total_minor >= 0),
  status text not null default 'initiated' check (status in ('initiated', 'paid', 'fulfilled', 'failed', 'refunded', 'mismatch')),
  provider_reference text,
  created_at timestamptz not null default now(), paid_at timestamptz, fulfilled_at timestamptz,
  unique (parent_user_id, idempotency_key)
);
create table if not exists public.family_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.family_orders(id) on delete cascade,
  position integer not null,
  beneficiary_user_id uuid not null references public.profiles(id),
  intent_reference text not null unique,
  coins bigint not null check (coins > 0),
  amount_minor bigint not null check (amount_minor > 0)
);
create index if not exists family_order_items_order on public.family_order_items(order_id, position);
alter table public.family_orders enable row level security;
alter table public.family_order_items enable row level security;
revoke all on public.family_orders, public.family_order_items from public, anon, authenticated;

create or replace function quizbox_core.family_order_json(p_order uuid) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('reference', o.reference, 'kind', o.kind, 'status', o.status, 'total_minor', o.total_minor, 'created_at', o.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('student_id', i.beneficiary_user_id, 'name', p.full_name, 'reference', i.intent_reference, 'coins', i.coins, 'amount_minor', i.amount_minor) order by i.position)
                         from public.family_order_items i join public.profiles p on p.id = i.beneficiary_user_id where i.order_id = o.id), '[]'::jsonb))
  from public.family_orders o where o.id = p_order
$fn$;
