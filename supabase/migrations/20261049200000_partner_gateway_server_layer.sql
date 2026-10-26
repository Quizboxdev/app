-- QuizBox Partner Access Gateway, phase 2-4 database support (additive to 20261049100000).
--   * staff seats: a contract may include 'staff' seats (for example teachers paid for by a school). A staff seat is a LICENCE record only: it never changes the person's QuizBox role. Roles stay with QuizBox
--     staff and school administrators. Staff seats share the contract's max_seats pool. Learner access (qb_partner_licence_active) counts learner seats only.
--   * partner slug for the sign-in entry page (/partner/<slug>), OIDC endpoints and an encrypted client secret on the identity configuration
--   * rate buckets for the partner API and the sign-in routes (counted in the database so every server instance shares them)
--   * lookups the server routes need: public entry details, OIDC configuration, member lookup, account match by verified domain, staff seat listing
-- Additive and idempotent. Rollback: supabase/rollback/partner_gateway_server_layer.sql.
begin;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
alter table public.partners add column if not exists slug text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'partners_slug_format') then
    alter table public.partners add constraint partners_slug_format check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{2,39}$');
  end if;
end $$;
create unique index if not exists partners_slug_unique on public.partners (slug) where slug is not null;

alter table public.partner_identity_configs add column if not exists authorization_endpoint text;
alter table public.partner_identity_configs add column if not exists token_endpoint text;
alter table public.partner_identity_configs add column if not exists client_secret_enc text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'partner_identity_endpoints_https') then
    alter table public.partner_identity_configs add constraint partner_identity_endpoints_https check (
      (authorization_endpoint is null or authorization_endpoint ~ '^https://[^\s]+$') and (token_endpoint is null or token_endpoint ~ '^https://[^\s]+$'));
  end if;
end $$;

alter table public.partner_seats add column if not exists seat_kind text not null default 'learner';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'partner_seats_kind_check') then
    alter table public.partner_seats add constraint partner_seats_kind_check check (seat_kind in ('learner', 'staff'));
  end if;
end $$;

alter table public.partner_contracts drop constraint if exists partner_contracts_capabilities_check;
alter table public.partner_contracts add constraint partner_contracts_capabilities_check
  check (cardinality(capabilities) > 0 and capabilities <@ array['practice', 'assignments', 'assessments', 'staff']);

create table if not exists public.partner_rate_buckets (
  bucket_key text not null, window_start timestamptz not null, n integer not null default 0,
  primary key (bucket_key, window_start)
);
alter table public.partner_rate_buckets enable row level security;
revoke all on public.partner_rate_buckets from anon, authenticated;
grant select, insert, update, delete on public.partner_rate_buckets to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Learner access counts learner seats only (staff seats never grant learner practice).
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_partner_licence_active(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_user is not null and coalesce(quizbox_core.flag('flags.partner_access_gateway_v1'), false) and exists (
    select 1 from public.partner_seats s join public.partner_contracts c on c.id = s.contract_id
     where s.user_id = p_user and s.status = 'active' and s.seat_kind = 'learner' and 'practice' = any(c.capabilities) and public.qb_partner_contract_live(c.id))
$fn$;

create or replace function public.qb_partner_staff_seat_active(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_user is not null and coalesce(quizbox_core.flag('flags.partner_access_gateway_v1'), false) and exists (
    select 1 from public.partner_seats s join public.partner_contracts c on c.id = s.contract_id
     where s.user_id = p_user and s.status = 'active' and s.seat_kind = 'staff' and 'staff' = any(c.capabilities) and public.qb_partner_contract_live(c.id))
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Seat allocation with a kind (replaces the 4-argument version).
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
drop function if exists public.qb_partner_seat_allocate(uuid, uuid, text, uuid);
create or replace function public.qb_partner_seat_allocate(p_partner uuid, p_contract uuid, p_external_ref text, p_user uuid default null, p_kind text default 'learner') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts; s public.partner_seats; v_ref text := btrim(coalesce(p_external_ref, '')); used integer; v_kind text := coalesce(p_kind, 'learner');
begin
  perform public.qb_pg_require_enabled();
  if v_ref = '' or char_length(v_ref) > 200 or v_kind not in ('learner', 'staff') then raise exception 'QB_PARTNER_INVALID_INPUT' using errcode = '22023'; end if;
  select * into c from public.partner_contracts where id = p_contract and partner_id = p_partner for update;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.qb_partner_contract_live(c.id) then raise exception 'QB_PARTNER_LICENCE_NOT_ACTIVE' using errcode = '55000'; end if;
  if v_kind = 'staff' and not ('staff' = any(c.capabilities)) then raise exception 'QB_PARTNER_STAFF_SEATS_NOT_IN_CONTRACT' using errcode = '55000'; end if;
  if v_kind = 'learner' and not ('practice' = any(c.capabilities)) then raise exception 'QB_PARTNER_LEARNER_SEATS_NOT_IN_CONTRACT' using errcode = '55000'; end if;
  if public.qb_pg_minor_blocked(p_user) then raise exception 'QB_PARTNER_MINOR_CONSENT_REQUIRED' using errcode = '42501'; end if;
  if v_kind = 'staff' and p_user is not null and exists (select 1 from public.student_profiles sp where sp.user_id = p_user and sp.is_minor) then raise exception 'QB_PARTNER_STAFF_SEAT_ADULT_ONLY' using errcode = '42501'; end if;
  select * into s from public.partner_seats where contract_id = c.id and external_ref = v_ref and status = 'active';
  if found then
    if s.seat_kind <> v_kind then raise exception 'QB_PARTNER_SEAT_KIND_CONFLICT' using errcode = '23505'; end if;
    if p_user is not null and s.user_id is null then update public.partner_seats set user_id = p_user where id = s.id returning * into s; end if;
    return jsonb_build_object('seat_id', s.id, 'duplicate', true, 'linked', s.user_id is not null, 'kind', s.seat_kind);
  end if;
  select count(*) into used from public.partner_seats where contract_id = c.id and status = 'active';
  if used >= c.max_seats then raise exception 'QB_PARTNER_SEAT_CAPACITY' using errcode = '55000'; end if;
  insert into public.partner_seats(contract_id, partner_id, external_ref, user_id, seat_kind) values (c.id, p_partner, v_ref, p_user, v_kind) returning * into s;
  perform public.qb_pg_audit(p_partner, 'partner.seat_allocate', 'partner_seats', s.id, jsonb_build_object('contract_id', c.id, 'kind', v_kind));
  return jsonb_build_object('seat_id', s.id, 'duplicate', false, 'linked', s.user_id is not null, 'kind', v_kind, 'remaining', c.max_seats - used - 1);
end $fn$;

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

create or replace function public.qb_admin_partner_seats(p_contract uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_staff();
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('external_ref', s.external_ref, 'kind', s.seat_kind, 'status', s.status, 'linked', s.user_id is not null, 'allocated_at', s.allocated_at, 'revoked_at', s.revoked_at) as x
      from public.partner_seats s where s.contract_id = p_contract order by s.allocated_at desc limit 500) q), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Server lookups (service role)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- What the public entry page may show: name and whether sign-in is ready. Nothing else.
create or replace function public.qb_partner_public_by_slug(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r record;
begin
  select p.id, p.name, p.kind, i.status as sso into r from public.partners p left join public.partner_identity_configs i on i.partner_id = p.id
   where p.slug = lower(btrim(coalesce(p_slug, ''))) and p.status = 'verified';
  if not found or not quizbox_core.flag('flags.partner_access_gateway_v1') then return null; end if;
  return jsonb_build_object('name', r.name, 'kind', r.kind, 'sso_ready', coalesce(r.sso = 'active', false));
end $fn$;

-- The OIDC settings the sign-in routes need (includes the client secret ciphertext; closed to browsers).
create or replace function public.qb_partner_oidc_config(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r record;
begin
  perform public.qb_pg_require_enabled();
  select p.id as partner_id, p.name, i.* into r from public.partners p join public.partner_identity_configs i on i.partner_id = p.id
   where p.slug = lower(btrim(coalesce(p_slug, ''))) and p.status = 'verified' and i.status = 'active' and i.protocol = 'oidc'
     and i.authorization_endpoint is not null and i.token_endpoint is not null and i.jwks_uri is not null;
  if not found then return null; end if;
  return jsonb_build_object('partner_id', r.partner_id, 'name', r.name, 'issuer', r.issuer, 'audience', r.audience, 'jwks_uri', r.jwks_uri, 'authorization_endpoint', r.authorization_endpoint,
    'token_endpoint', r.token_endpoint, 'client_secret_enc', r.client_secret_enc, 'allowed_domains', to_jsonb(r.allowed_domains), 'auto_provision', r.auto_provision);
end $fn$;

-- Find the QuizBox account for a verified partner sign-in. Order: an existing identity link; otherwise an account whose e-mail has the SAME domain the partner is configured for AND the partner marked
-- the address verified. Anything else returns no account (the person must sign in to QuizBox first and link, or the partner may provision).
create or replace function public.qb_partner_sso_find_account(p_partner uuid, p_issuer text, p_subject text, p_email text, p_email_verified boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare l public.partner_identity_links; cfg public.partner_identity_configs; v_email text := lower(btrim(coalesce(p_email, ''))); v_domain text; v_user uuid; n integer;
begin
  perform public.qb_pg_require_enabled();
  select * into l from public.partner_identity_links where issuer = p_issuer and subject = p_subject;
  if found then
    if l.partner_id <> p_partner or l.status <> 'active' then return jsonb_build_object('user_id', null, 'via', 'revoked'); end if;
    return jsonb_build_object('user_id', l.user_id, 'via', 'link');
  end if;
  select * into cfg from public.partner_identity_configs where partner_id = p_partner and status = 'active';
  if not found or not coalesce(p_email_verified, false) or position('@' in v_email) = 0 then return jsonb_build_object('user_id', null, 'via', 'none'); end if;
  v_domain := split_part(v_email, '@', 2);
  if not (v_domain = any (cfg.allowed_domains)) then return jsonb_build_object('user_id', null, 'via', 'none'); end if;
  select count(*), min(pr.id::text)::uuid into n, v_user from public.profiles pr where lower(pr.email) = v_email
     and lower(pr.role::text) in ('student', 'teacher') and not exists (select 1 from public.user_capabilities uc where uc.user_id = pr.id and uc.active);
  if n <> 1 then return jsonb_build_object('user_id', null, 'via', 'none'); end if;
  return jsonb_build_object('user_id', v_user, 'via', 'email_domain');
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Rate buckets: returns true while the caller is within the limit for the current window. Old windows are swept by the daily housekeeping.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_partner_rate_check(p_key text, p_limit integer, p_seconds integer) returns boolean language plpgsql security definer set search_path = '' as $fn$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / greatest(p_seconds, 1)) * greatest(p_seconds, 1)); c integer;
begin
  if p_key is null or char_length(p_key) > 200 then raise exception 'QB_PARTNER_INVALID_INPUT' using errcode = '22023'; end if;
  insert into public.partner_rate_buckets as b(bucket_key, window_start, n) values (p_key, w, 1)
  on conflict (bucket_key, window_start) do update set n = b.n + 1 returning n into c;
  return c <= p_limit;
end $fn$;

create or replace function public.qb_partner_contracts_expire() returns integer language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  update public.partner_contracts set status = 'expired', updated_at = now() where status in ('active', 'suspended') and expires_on < current_date;
  get diagnostics n = row_count;
  delete from public.partner_rate_buckets where window_start < now() - interval '1 day';
  return n;
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function public.qb_partner_staff_seat_active(uuid), public.qb_partner_licence_active(uuid) from public, anon, authenticated;
revoke all on function public.qb_partner_seat_allocate(uuid, uuid, text, uuid, text), public.qb_partner_seat_list(uuid, uuid, integer, timestamptz), public.qb_partner_member_lookup(uuid, text),
  public.qb_partner_public_by_slug(text), public.qb_partner_oidc_config(text), public.qb_partner_sso_find_account(uuid, text, text, text, boolean), public.qb_partner_rate_check(text, integer, integer),
  public.qb_partner_contracts_expire() from public, anon, authenticated;
grant execute on function public.qb_partner_staff_seat_active(uuid), public.qb_partner_licence_active(uuid), public.qb_partner_seat_allocate(uuid, uuid, text, uuid, text),
  public.qb_partner_seat_list(uuid, uuid, integer, timestamptz), public.qb_partner_member_lookup(uuid, text), public.qb_partner_public_by_slug(text), public.qb_partner_oidc_config(text),
  public.qb_partner_sso_find_account(uuid, text, text, text, boolean), public.qb_partner_rate_check(text, integer, integer), public.qb_partner_contracts_expire() to service_role;
revoke all on function public.qb_admin_partner_identity_save(uuid, text, text, text, text, text[], boolean, text), public.qb_admin_partner_slug_set(uuid, text), public.qb_admin_partner_oidc_endpoints_save(uuid, text, text, text), public.qb_admin_partner_detail(uuid),
  public.qb_admin_partner_seats(uuid) from public, anon;
grant execute on function public.qb_admin_partner_identity_save(uuid, text, text, text, text, text[], boolean, text), public.qb_admin_partner_slug_set(uuid, text), public.qb_admin_partner_oidc_endpoints_save(uuid, text, text, text), public.qb_admin_partner_detail(uuid),
  public.qb_admin_partner_seats(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
