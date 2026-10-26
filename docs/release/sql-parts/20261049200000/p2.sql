-- Seat list now shows the kind.
create or replace function public.qb_partner_seat_list(p_partner uuid, p_contract uuid, p_limit integer default 200, p_after timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_enabled();
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('external_ref', s.external_ref, 'kind', s.seat_kind, 'status', s.status, 'linked', s.user_id is not null, 'allocated_at', s.allocated_at) as x
      from public.partner_seats s where s.partner_id = p_partner and s.contract_id = p_contract and (p_after is null or s.allocated_at > p_after)
      order by s.allocated_at limit least(greatest(coalesce(p_limit, 200), 1), 500)) q), '[]'::jsonb);
end $fn$;

-- One member by the partner's own reference (needs the members:read scope in the route). No names, emails or learner data.
create or replace function public.qb_partner_member_lookup(p_partner uuid, p_external_ref text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_enabled();
  return coalesce((select jsonb_agg(jsonb_build_object('contract_id', s.contract_id, 'kind', s.seat_kind, 'status', s.status, 'linked', s.user_id is not null,
      'licensed_now', s.status = 'active' and public.qb_partner_contract_live(s.contract_id), 'allocated_at', s.allocated_at, 'revoked_at', s.revoked_at) order by s.allocated_at desc)
    from public.partner_seats s where s.partner_id = p_partner and s.external_ref = btrim(coalesce(p_external_ref, ''))), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Staff: slug, OIDC endpoints and client secret (ciphertext from the application), seat listing
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Identity configuration: the approved e-mail domains must belong to the partner. Public mail domains are refused so a partner can never sign in as someone else's personal account.
create or replace function public.qb_admin_partner_identity_save(p_partner uuid, p_protocol text, p_issuer text, p_audience text, p_jwks_uri text, p_domains text[], p_auto_provision boolean, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare d text; v_domains text[] := '{}';
begin
  perform public.qb_pg_require_staff();
  if not exists (select 1 from public.partners where id = p_partner) then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  foreach d in array coalesce(p_domains, '{}') loop
    d := lower(btrim(d));
    if d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then raise exception 'QB_PARTNER_DOMAIN_INVALID' using errcode = '22023'; end if;
    if d = any (array['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com']) then
      raise exception 'QB_PARTNER_PUBLIC_DOMAIN' using errcode = '22023'; end if;
    v_domains := v_domains || d;
  end loop;
  insert into public.partner_identity_configs(partner_id, protocol, issuer, audience, jwks_uri, allowed_domains, auto_provision, status, updated_by)
  values (p_partner, p_protocol, btrim(p_issuer), btrim(p_audience), nullif(btrim(p_jwks_uri), ''), v_domains, coalesce(p_auto_provision, false), coalesce(p_status, 'draft'), auth.uid())
  on conflict (partner_id) do update set protocol = excluded.protocol, issuer = excluded.issuer, audience = excluded.audience, jwks_uri = excluded.jwks_uri,
    allowed_domains = excluded.allowed_domains, auto_provision = excluded.auto_provision, status = excluded.status, updated_by = auth.uid(), updated_at = now();
  perform public.qb_pg_audit(p_partner, 'partner.identity_save', 'partner_identity_configs', p_partner, jsonb_build_object('protocol', p_protocol, 'status', coalesce(p_status, 'draft')));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.qb_admin_partner_slug_set(p_partner uuid, p_slug text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v text := lower(btrim(coalesce(p_slug, '')));
begin
  perform public.qb_pg_require_staff();
  update public.partners set slug = nullif(v, ''), updated_at = now() where id = p_partner;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_pg_audit(p_partner, 'partner.slug_set', 'partners', p_partner, jsonb_build_object('slug', v));
  return jsonb_build_object('ok', true, 'slug', nullif(v, ''));
end $fn$;

create or replace function public.qb_admin_partner_oidc_endpoints_save(p_partner uuid, p_authorization text, p_token text, p_client_secret_enc text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_staff();
  update public.partner_identity_configs set authorization_endpoint = nullif(btrim(p_authorization), ''), token_endpoint = nullif(btrim(p_token), ''),
    client_secret_enc = coalesce(nullif(p_client_secret_enc, ''), client_secret_enc), updated_by = auth.uid(), updated_at = now() where partner_id = p_partner;
  if not found then raise exception 'QB_PARTNER_IDENTITY_NOT_CONFIGURED' using errcode = 'P0002'; end if;
  perform public.qb_pg_audit(p_partner, 'partner.oidc_endpoints_save', 'partner_identity_configs', p_partner, jsonb_build_object('secret_changed', coalesce(p_client_secret_enc, '') <> ''));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.qb_admin_partner_detail(p_partner uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_staff();
  return jsonb_build_object(
    'partner', (select to_jsonb(p) - 'created_by' from public.partners p where p.id = p_partner),
    'identity', (select jsonb_build_object('protocol', i.protocol, 'issuer', i.issuer, 'audience', i.audience, 'jwks_uri', i.jwks_uri, 'authorization_endpoint', i.authorization_endpoint,
        'token_endpoint', i.token_endpoint, 'allowed_domains', i.allowed_domains, 'auto_provision', i.auto_provision, 'status', i.status, 'has_client_secret', i.client_secret_enc is not null)
      from public.partner_identity_configs i where i.partner_id = p_partner),
    'credentials', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'prefix', k.key_prefix, 'scopes', k.scopes, 'status', k.status, 'expires_at', k.expires_at, 'last_used_at', k.last_used_at) order by k.created_at desc)
      from public.partner_credentials k where k.partner_id = p_partner), '[]'::jsonb),
    'webhook_secret', (select jsonb_build_object('status', s.status, 'created_at', s.created_at) from public.partner_webhook_secrets s where s.partner_id = p_partner and s.status = 'active'),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'package', c.package_code, 'capabilities', c.capabilities, 'status', c.status, 'live', public.qb_partner_contract_live(c.id),
        'starts_on', c.starts_on, 'expires_on', c.expires_on, 'max_seats', c.max_seats, 'billing_ref', c.external_billing_ref, 'reconciliation', c.reconciliation_status, 'approval_note', c.approval_note,
        'learner_seats', (select count(*) from public.partner_seats s where s.contract_id = c.id and s.status = 'active' and s.seat_kind = 'learner'),
        'staff_seats', (select count(*) from public.partner_seats s where s.contract_id = c.id and s.status = 'active' and s.seat_kind = 'staff')) order by c.created_at desc)
      from public.partner_contracts c where c.partner_id = p_partner), '[]'::jsonb));
end $fn$;
