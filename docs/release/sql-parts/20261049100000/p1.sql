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
