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
