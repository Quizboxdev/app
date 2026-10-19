-- Web push notifications. A signed-in person can turn push on for a device; unread in-app notifications are then also delivered to that device.
-- The browser gives us an endpoint and two keys per device; they are stored here and used only by the server-side sender (/api/cron/push, service role).
--   qb_push_subscribe / qb_push_unsubscribe / qb_push_status    the signed-in person, for their own devices (managed learners under 13 are refused)
--   qb_push_pending(limit)    service role: unread notifications from the last 2 days that have not been pushed, with the owner's device subscriptions
--   qb_push_report(done, ok, gone, failed)   service role: records what happened (done notifications are never offered again; dead devices are removed)
-- Additive and idempotent. Rollback: supabase/rollback/push_notifications.sql.
alter table public.notifications add column if not exists push_sent_at timestamptz;
create index if not exists notifications_push_pending on public.notifications(created_at) where push_sent_at is null;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated, public;

create or replace function public.qb_push_allowed() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active')
    and not exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.managed_by is not null);
$fn$;

create or replace function public.qb_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.qb_push_allowed() then raise exception 'PUSH_NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failures = 0;
  -- keep at most 5 devices per person: the oldest go first
  delete from public.push_subscriptions where id in (select id from public.push_subscriptions where user_id = auth.uid() order by created_at desc offset 5);
  return jsonb_build_object('ok', true, 'devices', (select count(*) from public.push_subscriptions where user_id = auth.uid()));
end $fn$;

create or replace function public.qb_push_unsubscribe(p_endpoint text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'PUSH_NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = btrim(p_endpoint);
  return jsonb_build_object('ok', true, 'devices', (select count(*) from public.push_subscriptions where user_id = auth.uid()));
end $fn$;

create or replace function public.qb_push_status() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('allowed', public.qb_push_allowed(), 'devices', (select count(*) from public.push_subscriptions where user_id = auth.uid()));
$fn$;

create or replace function public.qb_push_pending(p_limit integer default 100) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('notification_id', n.id, 'user_id', n.recipient_user_id, 'title', n.title, 'message', n.message, 'link', n.link,
      'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)) from public.push_subscriptions s where s.user_id = n.recipient_user_id), '[]'::jsonb))
      order by n.created_at), '[]'::jsonb)
    from (select * from public.notifications where push_sent_at is null and read_at is null and recipient_user_id is not null and created_at > now() - interval '2 days'
           order by created_at limit least(greatest(coalesce(p_limit, 100), 1), 500)) n;
$fn$;

create or replace function public.qb_push_report(p_done uuid[], p_ok uuid[], p_gone uuid[], p_failed uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare dropped integer;
begin
  update public.notifications set push_sent_at = now() where id = any(coalesce(p_done, '{}'));
  update public.push_subscriptions set last_success_at = now(), failures = 0 where id = any(coalesce(p_ok, '{}'));
  delete from public.push_subscriptions where id = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set failures = failures + 1 where id = any(coalesce(p_failed, '{}'));
  delete from public.push_subscriptions where failures >= 5;
  get diagnostics dropped = row_count;
  return jsonb_build_object('ok', true, 'dropped_after_repeated_failures', dropped);
end $fn$;

revoke all on function public.qb_push_allowed(), public.qb_push_subscribe(text, text, text, text), public.qb_push_unsubscribe(text), public.qb_push_status(), public.qb_push_pending(integer), public.qb_push_report(uuid[], uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.qb_push_subscribe(text, text, text, text), public.qb_push_unsubscribe(text), public.qb_push_status() to authenticated;
grant execute on function public.qb_push_pending(integer), public.qb_push_report(uuid[], uuid[], uuid[], uuid[]) to service_role;

