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
