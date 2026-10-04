-- PROPOSAL ONLY — NOT A MIGRATION. Prerequisite for listing qb_auth_failure in
-- lib/operations/public-rpc-allowlist.ts. Review finding (2026-10-04): the current function
-- (20261004120000_competition_school_admin_ops.sql) is anonymous-by-necessity, returns nothing and
-- writes only a fixed row shape. However:
--   1. p_code accepts any 3–60 letters/spaces, so anonymous callers can store free text (possibly
--      names) instead of a telemetry code;
--   2. the 120/minute global cap runs count(*) over system_events on every anonymous call, and no
--      supporting index is visible in tracked migrations (system_events predates them).
-- This keeps the signature and grants unchanged (no permission change) and stores only a known
-- Supabase Auth error code or the fallback AUTH_FAILED.
begin;

create index if not exists system_events_type_created on public.system_events(event_type, created_at desc);

create or replace function public.qb_auth_failure(p_code text) returns void language plpgsql security definer set search_path = '' as $$
declare c text := lower(btrim(coalesce(p_code, '')));
begin
  if (select count(*) from public.system_events where event_type = 'AUTH_FAILURE' and created_at > now() - interval '1 minute') >= 120 then return; end if;
  insert into public.system_events(event_type, entity_type, severity, details)
  values ('AUTH_FAILURE', 'auth', 'warn', jsonb_build_object('code', case when c in (
    'invalid_credentials', 'email_not_confirmed', 'phone_not_confirmed', 'user_banned', 'user_not_found',
    'over_request_rate_limit', 'over_email_send_rate_limit', 'captcha_failed', 'validation_failed',
    'request_timeout', 'unexpected_failure', 'session_expired', 'refresh_token_not_found', 'mfa_verification_failed'
  ) then c else 'AUTH_FAILED' end));
end $$;

-- Grants are intentionally unchanged: execute stays with anon,authenticated (create or replace keeps ACLs).
commit;

-- Owner decisions still open: a retention period for system_events AUTH_FAILURE rows, and whether
-- the global cap should become per-source (would require a hashed client key from a server route,
-- as in docs/proposals/public-intake-contract.md) so a flood cannot hide genuine failures.
