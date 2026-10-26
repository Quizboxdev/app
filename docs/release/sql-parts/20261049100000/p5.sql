create or replace function public.qb_admin_partners_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_staff();
  return jsonb_build_object('enabled', quizbox_core.flag('flags.partner_access_gateway_v1'),
    'partners', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'country', p.country_code, 'status', p.status,
        'sso', (select i.status from public.partner_identity_configs i where i.partner_id = p.id),
        'credentials', (select count(*) from public.partner_credentials k where k.partner_id = p.id and k.status = 'active' and k.expires_at > now()),
        'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'package', c.package_code, 'status', c.status, 'live', public.qb_partner_contract_live(c.id), 'starts_on', c.starts_on, 'expires_on', c.expires_on,
            'max_seats', c.max_seats, 'allocated', (select count(*) from public.partner_seats s where s.contract_id = c.id and s.status = 'active'), 'billing_ref', c.external_billing_ref,
            'reconciliation', c.reconciliation_status) order by c.created_at desc) from public.partner_contracts c where c.partner_id = p.id), '[]'::jsonb),
        'dead_events', (select count(*) from public.partner_webhook_events e where e.partner_id = p.id and e.status in ('failed', 'dead'))) order by p.name) from public.partners p), '[]'::jsonb));
end $fn$;

create or replace function public.qb_admin_partner_events(p_partner uuid, p_status text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_staff();
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', e.id, 'event_id', e.event_id, 'type', e.event_type, 'status', e.status, 'attempts', e.attempts, 'error_code', e.error_code, 'received_at', e.received_at) as x
      from public.partner_webhook_events e where e.partner_id = p_partner and (p_status is null or e.status = p_status) order by e.received_at desc limit 200) q), '[]'::jsonb);
end $fn$;

-- Manual reconciliation: staff put a dead or failed event back so the next delivery is processed again.
create or replace function public.qb_admin_partner_event_requeue(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.partner_webhook_events;
begin
  perform public.qb_pg_require_staff();
  update public.partner_webhook_events set status = 'failed', attempts = 0, finished_at = null where id = p_id and status in ('failed', 'dead') returning * into e;
  if not found then raise exception 'QB_INVALID_TRANSITION' using errcode = '55000'; end if;
  perform public.qb_pg_audit(e.partner_id, 'partner.event_requeue', 'partner_webhook_events', e.id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.qb_admin_partner_audit(p_partner uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_staff();
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('action', a.action, 'entity', a.entity_type, 'actor', a.actor_user_id, 'details', a.details) as x
      from public.audit_logs a where a.action like 'partner.%' and a.details->>'partner_id' = p_partner::text order by a.id desc limit 200) q), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Partner functions (service role only; the server has already authenticated the partner and checked the scope). Each one is bound to the partner id it is given.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_partner_credential_verify(p_secret text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k public.partner_credentials;
begin
  perform public.qb_pg_require_enabled();
  if p_secret is null or char_length(p_secret) < 20 or char_length(p_secret) > 200 then raise exception 'QB_PARTNER_AUTH_INVALID' using errcode = '42501'; end if;
  select * into k from public.partner_credentials where key_prefix = left(p_secret, 13) and status = 'active' and expires_at > now();
  if not found or k.secret_hash <> encode(sha256(convert_to(p_secret, 'utf8')), 'hex') then raise exception 'QB_PARTNER_AUTH_INVALID' using errcode = '42501'; end if;
  if not exists (select 1 from public.partners where id = k.partner_id and status = 'verified') then raise exception 'QB_PARTNER_AUTH_INVALID' using errcode = '42501'; end if;
  if k.last_used_at is null or k.last_used_at < now() - interval '1 minute' then update public.partner_credentials set last_used_at = now() where id = k.id; end if;
  return jsonb_build_object('partner_id', k.partner_id, 'credential_id', k.id, 'scopes', to_jsonb(k.scopes));
end $fn$;

create or replace function public.qb_partner_webhook_secrets_active(p_partner uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_enabled();
  if not exists (select 1 from public.partners where id = p_partner and status = 'verified') then raise exception 'QB_PARTNER_AUTH_INVALID' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(s.secret_enc order by s.created_at desc) from public.partner_webhook_secrets s
                    where s.partner_id = p_partner and (s.status = 'active' or (s.status = 'retiring' and s.valid_until > now()))), '[]'::jsonb);
end $fn$;

create or replace function public.qb_partner_licence_status(p_partner uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_enabled();
  return coalesce((select jsonb_agg(jsonb_build_object('contract_id', c.id, 'package', c.package_code, 'status', c.status, 'active_now', public.qb_partner_contract_live(c.id), 'starts_on', c.starts_on, 'expires_on', c.expires_on,
      'max_seats', c.max_seats, 'allocated', a.n, 'remaining', greatest(c.max_seats - a.n, 0), 'reconciliation', c.reconciliation_status) order by c.created_at desc)
    from public.partner_contracts c cross join lateral (select count(*)::integer as n from public.partner_seats s where s.contract_id = c.id and s.status = 'active') a
    where c.partner_id = p_partner), '[]'::jsonb);
end $fn$;
