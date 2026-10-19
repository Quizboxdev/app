-- Rollback for 20261026100000_notification_dismiss.sql: restores the original qb_notifications (list, mark_read, mark_all_read) and drops the dismissed marker.
-- Notifications that were cleared come back (they were never deleted).
create or replace function public.qb_notifications(p_action text default 'list', p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare me uuid := auth.uid(); stored jsonb;
begin
  if me is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_action = 'mark_read' then update public.notifications set read_at = coalesce(read_at, now()) where id = (p_data->>'id')::uuid and recipient_user_id = me; return jsonb_build_object('ok', true);
  elsif p_action = 'mark_all_read' then update public.notifications set read_at = now() where recipient_user_id = me and read_at is null; return jsonb_build_object('ok', true);
  elsif p_action <> 'list' then raise exception 'INVALID_NOTIFICATION_ACTION'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'title', n.title, 'message', n.message, 'link', n.link, 'created_at', n.created_at, 'read', n.read_at is not null, 'live', false,
      'market', (select name from public.markets where id = n.market_id)) order by n.created_at desc), '[]')
    into stored from (select * from public.notifications where recipient_user_id = me and (not coalesce((p_data->>'unread_only')::boolean, false) or read_at is null) order by created_at desc limit 50) n;
  return jsonb_build_object('unread', (select count(*) from public.notifications where recipient_user_id = me and read_at is null), 'live', quizbox_ops.live_alerts(me), 'items', stored);
end $fn$;
alter table public.notifications drop column if exists dismissed_at;
