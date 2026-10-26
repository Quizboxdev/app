-- QuizBox Partner Access Gateway (QPAG), phase 1: the database foundation.
-- Approved schools and companies buy a licence bundle OUTSIDE QuizBox. QuizBox staff verify the partner and approve the contract by hand (the partner's own claim of payment is never
-- enough). The partner then allocates seats (people) inside the approved capacity; a seated person gets learner access through the existing access chokepoint qb_has_subscription().
--   partners                       the organisation: draft -> pending_verification -> verified -> suspended / revoked
--   partner_identity_configs       how its people sign in (OpenID Connect or SAML 2.0 metadata only: issuer, audience, keys URL; no secrets)
--   partner_identity_links         issuer + stable subject -> QuizBox account (one subject, one account)
--   partner_credentials            server-to-server API keys: only a SHA-256 hash is kept; shown once; scoped; rotating; revocable
--   partner_webhook_secrets        HMAC secrets for inbound events, kept ENCRYPTED by the application layer (opaque text here), two live at once during rotation
--   partner_webhook_events         one row per event id (idempotency), payload hash only, never the payload; failed events retry, then become dead letters for staff
--   partner_contracts              the licence: capabilities, scope, dates, max seats, external billing reference; DRAFT -> PENDING_APPROVAL -> ACTIVE -> SUSPENDED / EXPIRED / CANCELLED
--   partner_seats                  one row per person allocated; active seats can never pass max_seats (the contract row is locked while counting)
-- Access rule: a person has licensed access only while flags.partner_access_gateway_v1 is on AND the partner is verified AND the contract is ACTIVE and inside its dates AND the seat is active.
-- When the flag is off, or the licence ends, qb_has_subscription() answers exactly as it did before: accounts and learning history stay, free allowance and any subscription still apply.
-- Browsers can read or write none of these tables. Staff use the qb_admin_partner_* functions (super admin only); partners reach qb_partner_* only through the server with the service role.
-- Additive and idempotent. Rollback: supabase/rollback/partner_access_gateway.sql (keeps the records).
begin;

insert into public.platform_settings(key, value, description)
select 'flags.partner_access_gateway_v1', 'false'::jsonb, 'Partner licences, partner SSO and the partner API are open (default off)'
where not exists (select 1 from public.platform_settings p where p.key = 'flags.partner_access_gateway_v1' and p.scope_type = 'global');

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  kind text not null check (kind in ('school', 'company', 'other')),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  institution_id uuid,
  status text not null default 'draft' check (status in ('draft', 'pending_verification', 'verified', 'suspended', 'revoked')),
  status_note text check (status_note is null or char_length(status_note) <= 500),
  verified_by uuid, verified_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists partners_name_ci on public.partners (lower(btrim(name)));

create table if not exists public.partner_identity_configs (
  partner_id uuid primary key references public.partners(id),
  protocol text not null check (protocol in ('oidc', 'saml')),
  issuer text not null check (issuer ~ '^https://[^\s]+$' and char_length(issuer) <= 300),
  audience text not null check (char_length(btrim(audience)) between 1 and 300),
  jwks_uri text check (jwks_uri is null or jwks_uri ~ '^https://[^\s]+$'),
  allowed_domains text[] not null default '{}',
  default_member_role text not null default 'learner' check (default_member_role = 'learner'),
  auto_provision boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'active', 'disabled')),
  updated_by uuid, updated_at timestamptz not null default now()
);

create table if not exists public.partner_identity_links (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  issuer text not null, subject text not null check (char_length(subject) between 1 and 300),
  user_id uuid not null,
  external_ref text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(), revoked_at timestamptz,
  unique (issuer, subject)
);
create index if not exists partner_identity_links_user on public.partner_identity_links (user_id);

create table if not exists public.partner_credentials (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  key_prefix text not null unique,
  secret_hash text not null,
  scopes text[] not null check (cardinality(scopes) > 0 and scopes <@ array['licence:read', 'seats:read', 'seats:write', 'members:read', 'health:read']),
  status text not null default 'active' check (status in ('active', 'revoked')),
  expires_at timestamptz not null,
  last_used_at timestamptz, rotated_from uuid,
  created_by uuid, created_at timestamptz not null default now(), revoked_at timestamptz
);

create table if not exists public.partner_webhook_secrets (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  secret_enc text not null,
  status text not null default 'active' check (status in ('active', 'retiring', 'revoked')),
  valid_until timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);
create unique index if not exists partner_webhook_one_active on public.partner_webhook_secrets (partner_id) where status = 'active';

create table if not exists public.partner_webhook_events (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  event_id text not null check (char_length(event_id) between 1 and 200),
  event_type text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'dead')),
  attempts integer not null default 1, error_code text check (error_code is null or char_length(error_code) <= 80),
  received_at timestamptz not null default now(), finished_at timestamptz,
  unique (partner_id, event_id)
);

create table if not exists public.partner_contracts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  package_code text not null check (char_length(btrim(package_code)) between 1 and 80),
  capabilities text[] not null default array['practice'] check (cardinality(capabilities) > 0 and capabilities <@ array['practice', 'assignments', 'assessments']),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  curriculum_scope text[] not null default '{}', grades text[] not null default '{}',
  starts_on date not null, expires_on date not null,
  max_seats integer not null check (max_seats between 1 and 1000000),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'active', 'suspended', 'expired', 'cancelled')),
  external_billing_ref text check (external_billing_ref is null or char_length(external_billing_ref) <= 200),
  reconciliation_status text not null default 'unreconciled' check (reconciliation_status in ('unreconciled', 'reconciled', 'disputed')),
  approved_by uuid, approved_at timestamptz, approval_note text check (approval_note is null or char_length(approval_note) <= 500),
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (expires_on >= starts_on)
);
create index if not exists partner_contracts_partner on public.partner_contracts (partner_id, status);

create table if not exists public.partner_seats (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.partner_contracts(id),
  partner_id uuid not null references public.partners(id),
  external_ref text not null check (char_length(external_ref) between 1 and 200),
  user_id uuid,
  status text not null default 'active' check (status in ('active', 'revoked')),
  allocated_at timestamptz not null default now(), revoked_at timestamptz, revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 200)
);
create unique index if not exists partner_seats_active_ref on public.partner_seats (contract_id, external_ref) where status = 'active';
create unique index if not exists partner_seats_active_user on public.partner_seats (contract_id, user_id) where status = 'active' and user_id is not null;
create index if not exists partner_seats_user on public.partner_seats (user_id) where status = 'active' and user_id is not null;

alter table public.partners enable row level security; alter table public.partner_identity_configs enable row level security; alter table public.partner_identity_links enable row level security;
alter table public.partner_credentials enable row level security; alter table public.partner_webhook_secrets enable row level security; alter table public.partner_webhook_events enable row level security;
alter table public.partner_contracts enable row level security; alter table public.partner_seats enable row level security;
revoke all on public.partners, public.partner_identity_configs, public.partner_identity_links, public.partner_credentials, public.partner_webhook_secrets, public.partner_webhook_events,
  public.partner_contracts, public.partner_seats from anon, authenticated;
grant select, insert, update on public.partners, public.partner_identity_configs, public.partner_identity_links, public.partner_credentials, public.partner_webhook_secrets,
  public.partner_webhook_events, public.partner_contracts, public.partner_seats to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_pg_is_staff() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and quizbox_core.is_staff(array['super_admin']);
$fn$;

create or replace function public.qb_pg_require_staff() returns void language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not public.qb_pg_is_staff() then raise exception 'QB_NOT_AUTHORIZED' using errcode = '42501'; end if;
end $fn$;

create or replace function public.qb_pg_require_enabled() returns void language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not quizbox_core.flag('flags.partner_access_gateway_v1') then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
end $fn$;

-- A contract is live when the flag is on, the partner is verified, the contract is ACTIVE and today is inside its dates.
create or replace function public.qb_partner_contract_live(p_contract uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce(quizbox_core.flag('flags.partner_access_gateway_v1'), false) and exists (
    select 1 from public.partner_contracts c join public.partners p on p.id = c.partner_id
     where c.id = p_contract and c.status = 'active' and p.status = 'verified' and current_date between c.starts_on and c.expires_on)
$fn$;

-- Minors may be seated only when a school manages the account (the school holds the consent); a free-standing minor needs guardian consent through the normal route first.
create or replace function public.qb_pg_minor_blocked(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_user is not null and exists (select 1 from public.student_profiles sp where sp.user_id = p_user and sp.is_minor and sp.managed_by is null)
$fn$;

create or replace function public.qb_pg_audit(p_partner uuid, p_action text, p_entity text, p_id uuid, p_details jsonb default '{}') returns void
language sql security definer set search_path = '' as $fn$
  select quizbox_core.audit(p_action, p_entity, p_id, coalesce(p_details, '{}'::jsonb) || jsonb_build_object('partner_id', p_partner));
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The entitlement hook: licensed access counts as access. With the flag off this is exactly the earlier answer.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_partner_licence_active(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_user is not null and coalesce(quizbox_core.flag('flags.partner_access_gateway_v1'), false) and exists (
    select 1 from public.partner_seats s join public.partner_contracts c on c.id = s.contract_id
     where s.user_id = p_user and s.status = 'active' and 'practice' = any(c.capabilities) and public.qb_partner_contract_live(c.id))
$fn$;

create or replace function public.qb_has_subscription(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.learner_subscriptions s where s.user_id = p_user and s.status = 'active' and s.valid_from <= now() and s.valid_until > now())
      or public.qb_partner_licence_active(p_user)
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Staff functions (super admin only). Every change is written to the audit log; no secret is ever written there.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_admin_partner_save(p_id uuid, p_name text, p_kind text, p_country text, p_institution uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare r public.partners;
begin
  perform public.qb_pg_require_staff();
  if p_id is null then
    insert into public.partners(name, kind, country_code, institution_id, created_by) values (btrim(p_name), p_kind, upper(nullif(btrim(p_country), '')), p_institution, auth.uid()) returning * into r;
    perform public.qb_pg_audit(r.id, 'partner.create', 'partners', r.id, jsonb_build_object('kind', r.kind));
  else
    update public.partners set name = btrim(p_name), kind = p_kind, country_code = upper(nullif(btrim(p_country), '')), institution_id = p_institution, updated_at = now() where id = p_id returning * into r;
    if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
    perform public.qb_pg_audit(r.id, 'partner.update', 'partners', r.id, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status);
end $fn$;

-- Verification, suspension and revocation. Verifying needs a note (what evidence was checked).
create or replace function public.qb_admin_partner_set_status(p_id uuid, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare r public.partners; v_note text := left(btrim(coalesce(p_note, '')), 500);
begin
  perform public.qb_pg_require_staff();
  if p_status not in ('pending_verification', 'verified', 'suspended', 'revoked') then raise exception 'QB_PARTNER_INVALID_STATUS' using errcode = '22023'; end if;
  if p_status in ('verified', 'suspended', 'revoked') and v_note = '' then raise exception 'QB_NOTE_REQUIRED' using errcode = '22023'; end if;
  select * into r from public.partners where id = p_id for update;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status = 'revoked' then raise exception 'QB_PARTNER_REVOKED' using errcode = '55000'; end if;
  update public.partners set status = p_status, status_note = nullif(v_note, ''), updated_at = now(),
    verified_by = case when p_status = 'verified' then auth.uid() else verified_by end, verified_at = case when p_status = 'verified' then now() else verified_at end where id = p_id returning * into r;
  if p_status = 'revoked' then
    update public.partner_credentials set status = 'revoked', revoked_at = now() where partner_id = p_id and status = 'active';
    update public.partner_webhook_secrets set status = 'revoked' where partner_id = p_id and status <> 'revoked';
    update public.partner_identity_configs set status = 'disabled', updated_at = now() where partner_id = p_id;
  end if;
  perform public.qb_pg_audit(p_id, 'partner.status', 'partners', p_id, jsonb_build_object('status', p_status));
  return jsonb_build_object('id', r.id, 'status', r.status);
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

-- API credentials: the secret is returned ONCE here and never again; only its SHA-256 hash is stored.
create or replace function public.qb_admin_partner_credential_issue(p_partner uuid, p_scopes text[], p_days integer default 90, p_rotated_from uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_secret text; v_id uuid; v_days integer := least(greatest(coalesce(p_days, 90), 1), 365);
begin
  perform public.qb_pg_require_staff();
  if not exists (select 1 from public.partners where id = p_partner and status = 'verified') then raise exception 'QB_PARTNER_NOT_VERIFIED' using errcode = '55000'; end if;
  v_secret := 'qbpk_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.partner_credentials(partner_id, key_prefix, secret_hash, scopes, expires_at, rotated_from, created_by)
  values (p_partner, left(v_secret, 13), encode(sha256(convert_to(v_secret, 'utf8')), 'hex'), p_scopes, now() + make_interval(days => v_days), p_rotated_from, auth.uid()) returning id into v_id;
  perform public.qb_pg_audit(p_partner, 'partner.credential_issue', 'partner_credentials', v_id, jsonb_build_object('scopes', p_scopes, 'days', v_days));
  return jsonb_build_object('id', v_id, 'key_prefix', left(v_secret, 13), 'secret', v_secret, 'expires_in_days', v_days);
end $fn$;

create or replace function public.qb_admin_partner_credential_revoke(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.partner_credentials;
begin
  perform public.qb_pg_require_staff();
  update public.partner_credentials set status = 'revoked', revoked_at = now() where id = p_id and status = 'active' returning * into r;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_pg_audit(r.partner_id, 'partner.credential_revoke', 'partner_credentials', r.id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $fn$;

-- Rotation: a new credential is issued and the old one keeps working for at most 24 hours so the partner can switch over.
create or replace function public.qb_admin_partner_credential_rotate(p_id uuid, p_days integer default 90) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare o public.partner_credentials; n jsonb;
begin
  perform public.qb_pg_require_staff();
  select * into o from public.partner_credentials where id = p_id and status = 'active' for update;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  n := public.qb_admin_partner_credential_issue(o.partner_id, o.scopes, p_days, o.id);
  update public.partner_credentials set expires_at = least(expires_at, now() + interval '24 hours') where id = o.id;
  perform public.qb_pg_audit(o.partner_id, 'partner.credential_rotate', 'partner_credentials', o.id, '{}'::jsonb);
  return n;
end $fn$;

-- Inbound-webhook secret. The application encrypts the secret before calling this; the database only ever holds the ciphertext. The previous one keeps verifying for 24 hours.
create or replace function public.qb_admin_partner_webhook_secret_rotate(p_partner uuid, p_secret_enc text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  perform public.qb_pg_require_staff();
  if p_secret_enc is null or char_length(p_secret_enc) < 20 then raise exception 'QB_PARTNER_INVALID_INPUT' using errcode = '22023'; end if;
  if not exists (select 1 from public.partners where id = p_partner and status = 'verified') then raise exception 'QB_PARTNER_NOT_VERIFIED' using errcode = '55000'; end if;
  update public.partner_webhook_secrets set status = 'retiring', valid_until = now() + interval '24 hours' where partner_id = p_partner and status = 'active';
  update public.partner_webhook_secrets set status = 'revoked' where partner_id = p_partner and status = 'retiring' and valid_until < now();
  insert into public.partner_webhook_secrets(partner_id, secret_enc, created_by) values (p_partner, p_secret_enc, auth.uid()) returning id into v_id;
  perform public.qb_pg_audit(p_partner, 'partner.webhook_secret_rotate', 'partner_webhook_secrets', v_id, '{}'::jsonb);
  return jsonb_build_object('id', v_id);
end $fn$;

create or replace function public.qb_admin_partner_contract_save(p_id uuid, p_partner uuid, p_package text, p_caps text[], p_country text, p_scope text[], p_grades text[],
  p_starts date, p_expires date, p_max integer, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts;
begin
  perform public.qb_pg_require_staff();
  if not exists (select 1 from public.partners where id = p_partner) then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_id is null then
    insert into public.partner_contracts(partner_id, package_code, capabilities, country_code, curriculum_scope, grades, starts_on, expires_on, max_seats, external_billing_ref, created_by)
    values (p_partner, btrim(p_package), coalesce(p_caps, array['practice']), upper(nullif(btrim(p_country), '')), coalesce(p_scope, '{}'), coalesce(p_grades, '{}'), p_starts, p_expires, p_max, nullif(btrim(p_ref), ''), auth.uid()) returning * into c;
    perform public.qb_pg_audit(p_partner, 'partner.contract_create', 'partner_contracts', c.id, jsonb_build_object('max_seats', c.max_seats));
  else
    select * into c from public.partner_contracts where id = p_id and partner_id = p_partner for update;
    if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
    if c.status not in ('draft', 'pending_approval') then raise exception 'QB_PARTNER_CONTRACT_LOCKED' using errcode = '55000'; end if;
    update public.partner_contracts set package_code = btrim(p_package), capabilities = coalesce(p_caps, capabilities), country_code = upper(nullif(btrim(p_country), '')), curriculum_scope = coalesce(p_scope, '{}'),
      grades = coalesce(p_grades, '{}'), starts_on = p_starts, expires_on = p_expires, max_seats = p_max, external_billing_ref = nullif(btrim(p_ref), ''), status = 'draft', updated_at = now() where id = p_id returning * into c;
    perform public.qb_pg_audit(p_partner, 'partner.contract_update', 'partner_contracts', c.id, jsonb_build_object('max_seats', c.max_seats));
  end if;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $fn$;

create or replace function public.qb_admin_partner_contract_submit(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts;
begin
  perform public.qb_pg_require_staff();
  update public.partner_contracts set status = 'pending_approval', updated_at = now() where id = p_id and status = 'draft' returning * into c;
  if not found then raise exception 'QB_INVALID_TRANSITION' using errcode = '55000'; end if;
  perform public.qb_pg_audit(c.partner_id, 'partner.contract_submit', 'partner_contracts', c.id, '{}'::jsonb);
  return jsonb_build_object('id', c.id, 'status', c.status);
end $fn$;

-- Approval is the commercial gate: a verified partner, an external billing reference, dates still ahead, a written note. A different person approves unless the owner does (and that is audited).
create or replace function public.qb_admin_partner_contract_approve(p_id uuid, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts; v_self boolean; v_owner boolean; v_note text := left(btrim(coalesce(p_note, '')), 500);
begin
  perform public.qb_pg_require_staff();
  if v_note = '' then raise exception 'QB_NOTE_REQUIRED' using errcode = '22023'; end if;
  select * into c from public.partner_contracts where id = p_id for update;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  if c.status <> 'pending_approval' then raise exception 'QB_INVALID_TRANSITION' using errcode = '55000'; end if;
  if not exists (select 1 from public.partners where id = c.partner_id and status = 'verified') then raise exception 'QB_PARTNER_NOT_VERIFIED' using errcode = '55000'; end if;
  if c.external_billing_ref is null then raise exception 'QB_BILLING_REFERENCE_REQUIRED' using errcode = '22023'; end if;
  if c.expires_on < current_date then raise exception 'QB_CONTRACT_ALREADY_EXPIRED' using errcode = '22023'; end if;
  v_self := c.created_by is not null and c.created_by = auth.uid();
  v_owner := exists (select 1 from public.profiles pr where pr.id = auth.uid() and lower(pr.role::text) = 'owner');
  if v_self and not v_owner then raise exception 'QB_SELF_APPROVAL_NOT_ALLOWED' using errcode = '42501'; end if;
  update public.partner_contracts set status = 'active', approved_by = auth.uid(), approved_at = now(), approval_note = v_note, updated_at = now() where id = p_id returning * into c;
  perform public.qb_pg_audit(c.partner_id, 'partner.contract_approve', 'partner_contracts', c.id, jsonb_build_object('max_seats', c.max_seats, 'self_approved', v_self));
  return jsonb_build_object('id', c.id, 'status', c.status);
end $fn$;

-- Suspend, reinstate, cancel. Access follows the status at once; seats and accounts are kept.
create or replace function public.qb_admin_partner_contract_set_status(p_id uuid, p_status text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts; v_note text := left(btrim(coalesce(p_note, '')), 500);
begin
  perform public.qb_pg_require_staff();
  if v_note = '' then raise exception 'QB_NOTE_REQUIRED' using errcode = '22023'; end if;
  select * into c from public.partner_contracts where id = p_id for update;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  if not ((p_status = 'suspended' and c.status = 'active') or (p_status = 'active' and c.status = 'suspended' and c.expires_on >= current_date)
          or (p_status = 'cancelled' and c.status in ('draft', 'pending_approval', 'active', 'suspended'))) then raise exception 'QB_INVALID_TRANSITION' using errcode = '55000'; end if;
  update public.partner_contracts set status = p_status, approval_note = v_note, updated_at = now() where id = p_id returning * into c;
  perform public.qb_pg_audit(c.partner_id, 'partner.contract_status', 'partner_contracts', c.id, jsonb_build_object('status', p_status));
  return jsonb_build_object('id', c.id, 'status', c.status);
end $fn$;

-- Amending a live contract (more seats, a later expiry, a corrected reference) is staff-only, needs a note and can never go below the seats already in use.
create or replace function public.qb_admin_partner_contract_amend(p_id uuid, p_max integer, p_expires date, p_ref text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts; used integer; v_note text := left(btrim(coalesce(p_note, '')), 500);
begin
  perform public.qb_pg_require_staff();
  if v_note = '' then raise exception 'QB_NOTE_REQUIRED' using errcode = '22023'; end if;
  select * into c from public.partner_contracts where id = p_id for update;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  if c.status not in ('active', 'suspended') then raise exception 'QB_INVALID_TRANSITION' using errcode = '55000'; end if;
  select count(*) into used from public.partner_seats where contract_id = p_id and status = 'active';
  if p_max < used then raise exception 'QB_PARTNER_SEATS_IN_USE' using errcode = '22023'; end if;
  update public.partner_contracts set max_seats = p_max, expires_on = p_expires, external_billing_ref = nullif(btrim(p_ref), ''), approval_note = v_note, updated_at = now() where id = p_id returning * into c;
  perform public.qb_pg_audit(c.partner_id, 'partner.contract_amend', 'partner_contracts', c.id, jsonb_build_object('max_seats', p_max, 'expires_on', p_expires));
  return jsonb_build_object('id', c.id, 'status', c.status, 'max_seats', c.max_seats);
end $fn$;

create or replace function public.qb_admin_partner_contract_reconcile(p_id uuid, p_state text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts;
begin
  perform public.qb_pg_require_staff();
  update public.partner_contracts set reconciliation_status = p_state, updated_at = now() where id = p_id returning * into c;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_pg_audit(c.partner_id, 'partner.contract_reconcile', 'partner_contracts', c.id, jsonb_build_object('state', p_state));
  return jsonb_build_object('id', c.id, 'reconciliation_status', c.reconciliation_status);
end $fn$;

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

-- Seat allocation: atomic and idempotent. The contract row is locked, so two simultaneous allocations cannot both take the last seat; a retry with the same reference returns the same seat.
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

create or replace function public.qb_partner_seat_revoke(p_partner uuid, p_external_ref text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  perform public.qb_pg_require_enabled();
  update public.partner_seats set status = 'revoked', revoked_at = now(), revoke_reason = left(btrim(coalesce(p_reason, '')), 200)
   where partner_id = p_partner and external_ref = btrim(coalesce(p_external_ref, '')) and status = 'active';
  get diagnostics n = row_count;
  if n > 0 then
    update public.partner_identity_links set status = 'revoked', revoked_at = now() where partner_id = p_partner and external_ref = btrim(p_external_ref) and status = 'active';
    perform public.qb_pg_audit(p_partner, 'partner.seat_revoke', 'partner_seats', null, jsonb_build_object('seats', n));
  end if;
  return jsonb_build_object('revoked', n);
end $fn$;

-- Membership lookup: references and whether each is linked to an account. No names, emails or learner data.
create or replace function public.qb_partner_seat_list(p_partner uuid, p_contract uuid, p_limit integer default 200, p_after timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_enabled();
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('external_ref', s.external_ref, 'status', s.status, 'linked', s.user_id is not null, 'allocated_at', s.allocated_at) as x
      from public.partner_seats s where s.partner_id = p_partner and s.contract_id = p_contract and (p_after is null or s.allocated_at > p_after)
      order by s.allocated_at limit least(greatest(coalesce(p_limit, 200), 1), 500)) q), '[]'::jsonb);
end $fn$;

-- After the server has VERIFIED a partner sign-in token (issuer, audience, signature, expiry, state, nonce), it links issuer + subject to the account and to the seat.
create or replace function public.qb_partner_sso_link(p_partner uuid, p_issuer text, p_subject text, p_user uuid, p_external_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare cfg public.partner_identity_configs; l public.partner_identity_links; s public.partner_seats; v_ref text := btrim(coalesce(p_external_ref, ''));
begin
  perform public.qb_pg_require_enabled();
  select * into cfg from public.partner_identity_configs where partner_id = p_partner and status = 'active';
  if not found or cfg.issuer <> p_issuer or not exists (select 1 from public.partners where id = p_partner and status = 'verified') then raise exception 'QB_PARTNER_AUTH_INVALID' using errcode = '42501'; end if;
  if p_user is null or coalesce(btrim(p_subject), '') = '' or v_ref = '' then raise exception 'QB_PARTNER_INVALID_INPUT' using errcode = '22023'; end if;
  if public.qb_pg_minor_blocked(p_user) then raise exception 'QB_PARTNER_MINOR_CONSENT_REQUIRED' using errcode = '42501'; end if;
  select * into l from public.partner_identity_links where issuer = p_issuer and subject = p_subject for update;
  if found and (l.user_id <> p_user or l.partner_id <> p_partner) then raise exception 'QB_PARTNER_IDENTITY_CONFLICT' using errcode = '23505'; end if;
  if found and l.status = 'revoked' then raise exception 'QB_PARTNER_MEMBER_REVOKED' using errcode = '42501'; end if;
  if not found then
    insert into public.partner_identity_links(partner_id, issuer, subject, user_id, external_ref) values (p_partner, p_issuer, p_subject, p_user, v_ref);
  end if;
  select s2.* into s from public.partner_seats s2 where s2.partner_id = p_partner and s2.external_ref = v_ref and s2.status = 'active' for update;
  if not found then return jsonb_build_object('linked', true, 'seat', false); end if;
  if s.user_id is not null and s.user_id <> p_user then raise exception 'QB_PARTNER_IDENTITY_CONFLICT' using errcode = '23505'; end if;
  update public.partner_seats set user_id = p_user where id = s.id;
  perform public.qb_pg_audit(p_partner, 'partner.sso_link', 'partner_seats', s.id, '{}'::jsonb);
  return jsonb_build_object('linked', true, 'seat', true, 'licensed', public.qb_partner_licence_active(p_user));
end $fn$;

-- Contract reference updates from the partner change the text only. Capacity, dates and status are never changed by a partner event.
create or replace function public.qb_partner_contract_reference_update(p_partner uuid, p_contract uuid, p_ref text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.partner_contracts;
begin
  perform public.qb_pg_require_enabled();
  update public.partner_contracts set external_billing_ref = left(nullif(btrim(coalesce(p_ref, '')), ''), 200), reconciliation_status = 'unreconciled', updated_at = now() where id = p_contract and partner_id = p_partner returning * into c;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_pg_audit(p_partner, 'partner.contract_reference', 'partner_contracts', c.id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $fn$;

-- Idempotency for inbound events. 'new' and 'retry' mean process it; 'duplicate' means it was already handled (answer 200 and do nothing).
create or replace function public.qb_partner_event_begin(p_partner uuid, p_event_id text, p_type text, p_sha256 text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.partner_webhook_events;
begin
  perform public.qb_pg_require_enabled();
  if p_type not in ('partner.seat.allocated', 'partner.seat.revoked', 'partner.member.updated', 'partner.contract.reference_updated') then raise exception 'QB_PARTNER_EVENT_UNSUPPORTED' using errcode = '22023'; end if;
  insert into public.partner_webhook_events(partner_id, event_id, event_type, payload_sha256) values (p_partner, p_event_id, p_type, p_sha256)
  on conflict (partner_id, event_id) do nothing returning * into e;
  if found then return jsonb_build_object('state', 'new'); end if;
  select * into e from public.partner_webhook_events where partner_id = p_partner and event_id = p_event_id for update;
  if e.payload_sha256 <> p_sha256 or e.event_type <> p_type then raise exception 'QB_PARTNER_EVENT_REPLAY_MISMATCH' using errcode = '22023'; end if;
  if e.status = 'failed' then update public.partner_webhook_events set status = 'received', attempts = attempts + 1 where id = e.id; return jsonb_build_object('state', 'retry'); end if;
  return jsonb_build_object('state', 'duplicate', 'status', e.status);
end $fn$;

create or replace function public.qb_partner_event_finish(p_partner uuid, p_event_id text, p_ok boolean, p_error text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.partner_webhook_events;
begin
  perform public.qb_pg_require_enabled();
  update public.partner_webhook_events set finished_at = now(), error_code = left(p_error, 80),
    status = case when p_ok then 'processed' when attempts >= 5 then 'dead' else 'failed' end
   where partner_id = p_partner and event_id = p_event_id returning * into e;
  if not found then raise exception 'QB_PARTNER_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('status', e.status);
end $fn$;

create or replace function public.qb_partner_health(p_partner uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_pg_require_enabled();
  return jsonb_build_object('partner_status', (select status from public.partners where id = p_partner), 'api_version', 'v1',
    'events_24h', (select count(*) from public.partner_webhook_events where partner_id = p_partner and received_at > now() - interval '24 hours'),
    'events_failed', (select count(*) from public.partner_webhook_events where partner_id = p_partner and status in ('failed', 'dead')),
    'sso', (select status from public.partner_identity_configs where partner_id = p_partner));
end $fn$;

-- Housekeeping, run daily by the server: contracts past their end date become EXPIRED. Access already ends on the date itself, so this only keeps the status honest.
create or replace function public.qb_partner_contracts_expire() returns integer language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  update public.partner_contracts set status = 'expired', updated_at = now() where status in ('active', 'suspended') and expires_on < current_date;
  get diagnostics n = row_count;
  return n;
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function public.qb_pg_is_staff(), public.qb_pg_require_staff(), public.qb_pg_require_enabled(), public.qb_partner_contract_live(uuid), public.qb_pg_minor_blocked(uuid),
  public.qb_pg_audit(uuid, text, text, uuid, jsonb), public.qb_partner_licence_active(uuid) from public, anon, authenticated;
revoke all on function public.qb_admin_partner_save(uuid, text, text, text, uuid), public.qb_admin_partner_set_status(uuid, text, text),
  public.qb_admin_partner_identity_save(uuid, text, text, text, text, text[], boolean, text), public.qb_admin_partner_credential_issue(uuid, text[], integer, uuid),
  public.qb_admin_partner_credential_revoke(uuid), public.qb_admin_partner_credential_rotate(uuid, integer), public.qb_admin_partner_webhook_secret_rotate(uuid, text),
  public.qb_admin_partner_contract_save(uuid, uuid, text, text[], text, text[], text[], date, date, integer, text), public.qb_admin_partner_contract_submit(uuid),
  public.qb_admin_partner_contract_approve(uuid, text), public.qb_admin_partner_contract_set_status(uuid, text, text), public.qb_admin_partner_contract_amend(uuid, integer, date, text, text),
  public.qb_admin_partner_contract_reconcile(uuid, text), public.qb_admin_partners_overview(), public.qb_admin_partner_events(uuid, text), public.qb_admin_partner_event_requeue(uuid),
  public.qb_admin_partner_audit(uuid) from public, anon;
grant execute on function public.qb_admin_partner_save(uuid, text, text, text, uuid), public.qb_admin_partner_set_status(uuid, text, text),
  public.qb_admin_partner_identity_save(uuid, text, text, text, text, text[], boolean, text), public.qb_admin_partner_credential_issue(uuid, text[], integer, uuid),
  public.qb_admin_partner_credential_revoke(uuid), public.qb_admin_partner_credential_rotate(uuid, integer), public.qb_admin_partner_webhook_secret_rotate(uuid, text),
  public.qb_admin_partner_contract_save(uuid, uuid, text, text[], text, text[], text[], date, date, integer, text), public.qb_admin_partner_contract_submit(uuid),
  public.qb_admin_partner_contract_approve(uuid, text), public.qb_admin_partner_contract_set_status(uuid, text, text), public.qb_admin_partner_contract_amend(uuid, integer, date, text, text),
  public.qb_admin_partner_contract_reconcile(uuid, text), public.qb_admin_partners_overview(), public.qb_admin_partner_events(uuid, text), public.qb_admin_partner_event_requeue(uuid),
  public.qb_admin_partner_audit(uuid) to authenticated;
revoke all on function public.qb_partner_credential_verify(text), public.qb_partner_webhook_secrets_active(uuid), public.qb_partner_licence_status(uuid), public.qb_partner_seat_allocate(uuid, uuid, text, uuid),
  public.qb_partner_seat_revoke(uuid, text, text), public.qb_partner_seat_list(uuid, uuid, integer, timestamptz), public.qb_partner_sso_link(uuid, text, text, uuid, text),
  public.qb_partner_contract_reference_update(uuid, uuid, text), public.qb_partner_event_begin(uuid, text, text, text), public.qb_partner_event_finish(uuid, text, boolean, text),
  public.qb_partner_health(uuid), public.qb_partner_contracts_expire() from public, anon, authenticated;
grant execute on function public.qb_partner_credential_verify(text), public.qb_partner_webhook_secrets_active(uuid), public.qb_partner_licence_status(uuid), public.qb_partner_seat_allocate(uuid, uuid, text, uuid),
  public.qb_partner_seat_revoke(uuid, text, text), public.qb_partner_seat_list(uuid, uuid, integer, timestamptz), public.qb_partner_sso_link(uuid, text, text, uuid, text),
  public.qb_partner_contract_reference_update(uuid, uuid, text), public.qb_partner_event_begin(uuid, text, text, text), public.qb_partner_event_finish(uuid, text, boolean, text),
  public.qb_partner_health(uuid), public.qb_partner_contracts_expire(), public.qb_partner_licence_active(uuid), public.qb_pg_minor_blocked(uuid) to service_role;

commit;
notify pgrst, 'reload schema';
