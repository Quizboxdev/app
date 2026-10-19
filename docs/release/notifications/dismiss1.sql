-- Clearing notifications. A person can dismiss one notification, clear the ones they have read, or clear everything. Dismissed notifications disappear from
-- their list and count, are marked read (so they are never pushed), and stay in the database as history (soft delete) for support.
--   qb_notifications(action, data) gains: dismiss (id), clear_read, clear_all. list and the unread count ignore dismissed rows.
-- Additive and idempotent. Rollback: supabase/rollback/notification_dismiss.sql.
alter table public.notifications add column if not exists dismissed_at timestamptz;

create or replace function public.qb_notifications(p_action text default 'list', p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare me uuid := auth.uid(); stored jsonb; changed integer;
begin
  if me is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_action = 'mark_read' then update public.notifications set read_at = coalesce(read_at, now()) where id = (p_data->>'id')::uuid and recipient_user_id = me; return jsonb_build_object('ok', true);
  elsif p_action = 'mark_all_read' then update public.notifications set read_at = now() where recipient_user_id = me and read_at is null and dismissed_at is null; return jsonb_build_object('ok', true);
  elsif p_action = 'dismiss' then
    update public.notifications set dismissed_at = coalesce(dismissed_at, now()), read_at = coalesce(read_at, now()) where id = (p_data->>'id')::uuid and recipient_user_id = me;
    return jsonb_build_object('ok', true);
  elsif p_action = 'clear_read' then
    update public.notifications set dismissed_at = now() where recipient_user_id = me and dismissed_at is null and read_at is not null;
    get diagnostics changed = row_count; return jsonb_build_object('ok', true, 'cleared', changed);
  elsif p_action = 'clear_all' then
    update public.notifications set dismissed_at = now(), read_at = coalesce(read_at, now()) where recipient_user_id = me and dismissed_at is null;
    get diagnostics changed = row_count; return jsonb_build_object('ok', true, 'cleared', changed);
  elsif p_action <> 'list' then raise exception 'INVALID_NOTIFICATION_ACTION'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'title', n.title, 'message', n.message, 'link', n.link, 'created_at', n.created_at, 'read', n.read_at is not null, 'live', false,
      'market', (select name from public.markets where id = n.market_id)) order by n.created_at desc), '[]')
    into stored from (select * from public.notifications where recipient_user_id = me and dismissed_at is null and (not coalesce((p_data->>'unread_only')::boolean, false) or read_at is null) order by created_at desc limit 50) n;
  return jsonb_build_object('unread', (select count(*) from public.notifications where recipient_user_id = me and read_at is null and dismissed_at is null), 'live', quizbox_ops.live_alerts(me), 'items', stored);
end $fn$;
revoke all on function public.qb_notifications(text, jsonb) from public, anon;
grant execute on function public.qb_notifications(text, jsonb) to authenticated;

