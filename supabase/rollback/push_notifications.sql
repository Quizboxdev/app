-- Rollback for 20261025100000_push_notifications.sql. Removes every saved device subscription (people must turn push on again) and the push marker on notifications.
drop function if exists public.qb_push_report(uuid[], uuid[], uuid[], uuid[]), public.qb_push_pending(integer), public.qb_push_status(), public.qb_push_unsubscribe(text),
  public.qb_push_subscribe(text, text, text, text), public.qb_push_allowed();
drop table if exists public.push_subscriptions;
drop index if exists public.notifications_push_pending;
alter table public.notifications drop column if exists push_sent_at;
