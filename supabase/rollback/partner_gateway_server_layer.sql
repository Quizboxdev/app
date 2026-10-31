-- Rollback for 20261049200000_partner_gateway_server_layer.sql: puts the phase-1 versions of the changed functions back, removes the functions this migration added, and keeps the data
-- (slug, OIDC endpoints, seat kinds, rate buckets). Run this BEFORE partner_access_gateway.sql if both are being rolled back. Staff seats already allocated stay as records and grant nothing.
begin;
update public.platform_settings set value = 'false'::jsonb where key = 'flags.partner_access_gateway_v1' and scope_type = 'global';
drop function if exists public.qb_partner_seat_allocate(uuid, uuid, text, uuid, text);
create or replace function public.qb_partner_licence_active(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_user is not null and coalesce(quizbox_core.flag('flags.partner_access_gateway_v1'), false) and exists (
    select 1 from public.partner_seats s join public.partner_contracts c on c.id = s.contract_id
     where s.user_id = p_user and s.status = 'active' and 'practice' = any(c.capabilities) and public.qb_partner_contract_live(c.id))
$fn$;
create or replace function public.qb_partner_seat_allocate(p_partner uuid, p_contract uuid, p_external_ref text, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts; s public.partner_seats; v_ref text := btrim(coalesce(p_external_ref, '')); used integer;
begin
  perform public.qb_pg_require_enabled();
  if v_ref = '' or char_length(v_ref) > 200 then raise exception 'QB_PARTNER_INVALID_INPUT' using errcode = '22023'; end if;
  select * into c from public.partner_contracts where id = p_contract and partner_id = p_partner for update;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.qb_partner_contract_live(c.id) then raise exception 'QB_PARTNER_LICENCE_NOT_ACTIVE' using errcode = '55000'; end if;
  if public.qb_pg_minor_blocked(p_user) then raise exception 'QB_PARTNER_MINOR_CONSENT_REQUIRED' using errcode = '42501'; end if;
  select * into s from public.partner_seats where contract_id = c.id and external_ref = v_ref and status = 'active';
  if found then
    if p_user is not null and s.user_id is null then update public.partner_seats set user_id = p_user where id = s.id returning * into s; end if;
    return jsonb_build_object('seat_id', s.id, 'duplicate', true, 'linked', s.user_id is not null);
  end if;
  select count(*) into used from public.partner_seats where contract_id = c.id and status = 'active';
  if used >= c.max_seats then raise exception 'QB_PARTNER_SEAT_CAPACITY' using errcode = '55000'; end if;
  insert into public.partner_seats(contract_id, partner_id, external_ref, user_id) values (c.id, p_partner, v_ref, p_user) returning * into s;
  perform public.qb_pg_audit(p_partner, 'partner.seat_allocate', 'partner_seats', s.id, jsonb_build_object('contract_id', c.id));
  return jsonb_build_object('seat_id', s.id, 'duplicate', false, 'linked', s.user_id is not null, 'remaining', c.max_seats - used - 1);
end $fn$;
create or replace function public.qb_partner_seat_list(p_partner uuid, p_contract uuid, p_limit integer default 200, p_after timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_enabled();
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('external_ref', s.external_ref, 'status', s.status, 'linked', s.user_id is not null, 'allocated_at', s.allocated_at) as x
      from public.partner_seats s where s.partner_id = p_partner and s.contract_id = p_contract and (p_after is null or s.allocated_at > p_after)
      order by s.allocated_at limit least(greatest(coalesce(p_limit, 200), 1), 500)) q), '[]'::jsonb);
end $fn$;
create or replace function public.qb_partner_contracts_expire() returns integer language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  update public.partner_contracts set status = 'expired', updated_at = now() where status in ('active', 'suspended') and expires_on < current_date;
  get diagnostics n = row_count;
  return n;
end $fn$;
create or replace function public.qb_admin_partner_identity_save(p_partner uuid, p_protocol text, p_issuer text, p_audience text, p_jwks_uri text, p_domains text[], p_auto_provision boolean, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_staff();
  if not exists (select 1 from public.partners where id = p_partner) then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.partner_identity_configs(partner_id, protocol, issuer, audience, jwks_uri, allowed_domains, auto_provision, status, updated_by)
  values (p_partner, p_protocol, btrim(p_issuer), btrim(p_audience), nullif(btrim(p_jwks_uri), ''), coalesce(p_domains, '{}'), coalesce(p_auto_provision, false), coalesce(p_status, 'draft'), auth.uid())
  on conflict (partner_id) do update set protocol = excluded.protocol, issuer = excluded.issuer, audience = excluded.audience, jwks_uri = excluded.jwks_uri,
    allowed_domains = excluded.allowed_domains, auto_provision = excluded.auto_provision, status = excluded.status, updated_by = auth.uid(), updated_at = now();
  perform public.qb_pg_audit(p_partner, 'partner.identity_save', 'partner_identity_configs', p_partner, jsonb_build_object('protocol', p_protocol, 'status', coalesce(p_status, 'draft')));
  return jsonb_build_object('ok', true);
end $fn$;
drop function if exists public.qb_partner_staff_seat_active(uuid), public.qb_partner_member_lookup(uuid, text), public.qb_partner_public_by_slug(text), public.qb_partner_oidc_config(text),
  public.qb_partner_sso_find_account(uuid, text, text, text, boolean), public.qb_partner_rate_check(text, integer, integer), public.qb_admin_partner_slug_set(uuid, text),
  public.qb_admin_partner_oidc_endpoints_save(uuid, text, text, text), public.qb_admin_partner_detail(uuid), public.qb_admin_partner_seats(uuid);
alter table public.partner_contracts drop constraint if exists partner_contracts_capabilities_check;
alter table public.partner_contracts add constraint partner_contracts_capabilities_check check (cardinality(capabilities) > 0 and capabilities <@ array['practice', 'assignments', 'assessments']) not valid;
revoke all on function public.qb_partner_licence_active(uuid), public.qb_partner_seat_allocate(uuid, uuid, text, uuid), public.qb_partner_seat_list(uuid, uuid, integer, timestamptz), public.qb_partner_contracts_expire() from public, anon, authenticated;
grant execute on function public.qb_partner_licence_active(uuid), public.qb_partner_seat_allocate(uuid, uuid, text, uuid), public.qb_partner_seat_list(uuid, uuid, integer, timestamptz), public.qb_partner_contracts_expire() to service_role;
commit;
notify pgrst, 'reload schema';
