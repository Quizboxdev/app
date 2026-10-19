-- Client error monitoring (completion plan Phase 3 step 6, tracker G9). The browser reports crashes and unhandled errors to a server route, which calls
-- the write function below with the service-role key. Staff read a grouped summary. In-house on purpose: no third-party service sees user data.
-- Privacy: only the page path (no query string, ids replaced), an error digest and a short message with emails and long numbers removed are stored.
-- Limits: identical errors from one page are counted, not repeated (10-minute window); a global cap of 600 reports an hour protects the table.
--   public.qb_record_client_error(kind, route, digest, message)   executable by service_role ONLY
--   public.qb_admin_client_errors(hours)                          super admin or support staff (sme_support)
begin;

create or replace function public.qb_record_client_error(p_kind text, p_route text, p_digest text, p_message text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare route text; digest text; msg text; n integer;
begin
  if p_kind not in ('RENDER', 'UNHANDLED', 'NETWORK') then raise exception 'QB_INVALID_EVENT'; end if;
  -- path only: drop query and fragment, replace uuids and long numbers so no identifier is stored
  route := left(regexp_replace(regexp_replace(regexp_replace(coalesce(split_part(split_part(p_route, '?', 1), '#', 1), ''),
            '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id', 'g'), '[0-9]{4,}', ':n', 'g'), '[^A-Za-z0-9/_:.-]', '', 'g'), 120);
  digest := left(regexp_replace(coalesce(p_digest, ''), '[^A-Za-z0-9]', '', 'g'), 64);
  msg := left(regexp_replace(regexp_replace(coalesce(p_message, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'), '[0-9]{6,}', '[n]', 'g'), 200);
  if route = '' then route := '/'; end if;
  if not quizbox_private.consume_intake_budget('clienterr:global:h', 600, 3600) then return; end if;
  -- the table's key type is not part of this repository, so the existing row is addressed by ctid, which works for any key
  update public.system_events set details = jsonb_set(details, '{count}', to_jsonb(coalesce((details ->> 'count')::integer, 1) + 1))
   where ctid = (select ctid from public.system_events
                  where event_type = 'CLIENT_ERROR' and created_at > now() - interval '10 minutes' and details ->> 'route' = route and details ->> 'digest' = digest and details ->> 'kind' = p_kind
                  order by created_at desc limit 1);
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.system_events(event_type, entity_type, severity, details)
    values ('CLIENT_ERROR', 'web', 'error', jsonb_build_object('kind', p_kind, 'route', route, 'digest', digest, 'message', msg, 'count', 1));
  end if;
end $fn$;

create or replace function public.qb_admin_client_errors(p_hours integer default 24) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare h integer := least(greatest(coalesce(p_hours, 24), 1), 720);
begin
  if auth.uid() is null or not (quizbox_market.is_super() or quizbox_sme.has_capability('sme_support')) then raise exception 'SUPPORT_ACCESS_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('hours', h,
    'total', coalesce((select sum(coalesce((details ->> 'count')::integer, 1)) from public.system_events where event_type = 'CLIENT_ERROR' and created_at > now() - make_interval(hours => h)), 0),
    'last_hour', coalesce((select sum(coalesce((details ->> 'count')::integer, 1)) from public.system_events where event_type = 'CLIENT_ERROR' and created_at > now() - interval '1 hour'), 0),
    'groups', coalesce((select jsonb_agg(g order by (g ->> 'count')::integer desc) from (
        select jsonb_build_object('route', details ->> 'route', 'kind', details ->> 'kind', 'message', max(details ->> 'message'), 'digest', details ->> 'digest',
               'count', sum(coalesce((details ->> 'count')::integer, 1)), 'last_seen', max(created_at)) as g
          from public.system_events where event_type = 'CLIENT_ERROR' and created_at > now() - make_interval(hours => h)
         group by details ->> 'route', details ->> 'kind', details ->> 'digest' order by sum(coalesce((details ->> 'count')::integer, 1)) desc limit 50) x), '[]'::jsonb));
end $fn$;

revoke all on function public.qb_record_client_error(text, text, text, text) from public, anon, authenticated;
grant execute on function public.qb_record_client_error(text, text, text, text) to service_role;
revoke all on function public.qb_admin_client_errors(integer) from public, anon;
grant execute on function public.qb_admin_client_errors(integer) to authenticated;

commit;
