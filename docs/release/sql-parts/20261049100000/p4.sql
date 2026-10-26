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
