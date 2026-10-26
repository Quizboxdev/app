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


notify pgrst, 'reload schema';
