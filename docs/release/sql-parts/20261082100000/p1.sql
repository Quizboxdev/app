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

create or replace function public.qb_family_order_create(p_kind text, p_items jsonb, p_idem text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid; o public.family_orders; it jsonb; sid uuid; n integer; coins bigint; intent jsonb; total bigint := 0; seen uuid[] := '{}'; idx integer := 0; perm text;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  if p_kind not in ('coins', 'subscription') or p_idem is null or char_length(p_idem) not between 8 and 120 or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 10 then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select * into o from public.family_orders where parent_user_id = uid and idempotency_key = p_idem;
  if o.id is not null then return quizbox_core.family_order_json(o.id); end if;
  perm := case p_kind when 'coins' then 'buy_coins' else 'buy_subscription' end;
  for it in select * from jsonb_array_elements(p_items) loop
    begin sid := (it ->> 'student_id')::uuid; coins := (it ->> 'coins')::bigint; exception when others then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end;
    if sid is null or coins is null or coins < 1 or coins > 1000 or sid = any(seen) then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
    if not quizbox_core.family_can(uid, sid, perm) then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
    seen := seen || sid;
  end loop;
  insert into public.family_orders(parent_user_id, workspace_id, kind, idempotency_key) values (uid, w, p_kind, p_idem) returning * into o;
  for it in select * from jsonb_array_elements(p_items) loop
    idx := idx + 1; sid := (it ->> 'student_id')::uuid; coins := (it ->> 'coins')::bigint;
    intent := public.qb_payment_intent_create(sid, coins, 'GHS', 'paystack', 'mobile_money', left(p_idem, 80) || ':' || sid::text);
    insert into public.family_order_items(order_id, position, beneficiary_user_id, intent_reference, coins, amount_minor) values (o.id, idx, sid, intent ->> 'reference', coins, (intent ->> 'amount_minor')::bigint);
    total := total + (intent ->> 'amount_minor')::bigint;
  end loop;
  update public.family_orders set total_minor = total where id = o.id;
  perform quizbox_core.audit('family.order_create', 'family_orders', o.id, jsonb_build_object('kind', p_kind, 'children', n, 'total_minor', total));
  return quizbox_core.family_order_json(o.id);
end $fn$;
