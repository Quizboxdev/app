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
