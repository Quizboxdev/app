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
