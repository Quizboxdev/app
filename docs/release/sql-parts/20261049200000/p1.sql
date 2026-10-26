-- QuizBox Partner Access Gateway, phase 2-4 database support (additive to 20261049100000).
--   * staff seats: a contract may include 'staff' seats (for example teachers paid for by a school). A staff seat is a LICENCE record only: it never changes the person's QuizBox role. Roles stay with QuizBox
--     staff and school administrators. Staff seats share the contract's max_seats pool. Learner access (qb_partner_licence_active) counts learner seats only.
--   * partner slug for the sign-in entry page (/partner/<slug>), OIDC endpoints and an encrypted client secret on the identity configuration
--   * rate buckets for the partner API and the sign-in routes (counted in the database so every server instance shares them)
--   * lookups the server routes need: public entry details, OIDC configuration, member lookup, account match by verified domain, staff seat listing
-- Additive and idempotent. Rollback: supabase/rollback/partner_gateway_server_layer.sql.


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
