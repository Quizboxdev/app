begin;

-- Hardening of the anonymous login-failure telemetry path (review: docs/security/pre-login-functions-review.md; proposal:
-- docs/proposals/qb_auth_failure_hardening.sql). Signature, grants (anon, authenticated) and the RPC-based path are unchanged.
--
--  1. Direct table access: anon/authenticated held every table privilege on public.system_events (including TRUNCATE, which RLS does not
--     cover). Only SECURITY DEFINER functions read/write the table, so direct privileges are revoked (service_role is untouched).
--  2. Input: p_code is no longer stored as free text. Only known Supabase Auth error codes are recorded; anything else becomes AUTH_FAILED.
--  3. No global blinding: a per-source budget (10 events/minute/source) is enforced before the existing global 120/minute backstop, so one
--     caller can no longer exhaust the global cap and hide genuine failures. The source is the Cloudflare-set cf-connecting-ip (not
--     client-controllable: Cloudflare rejects a client-supplied value), falling back to the proxy-appended right-most x-forwarded-for entry.
--     Only a daily-rotating SHA-256 digest of the source is stored (pseudonymised, never the address). Residual risk: an attacker with
--     12+ distinct source addresses can still saturate the global cap.
--  4. Bounded retention: AUTH_FAILURE rows older than 30 days (and per-source budget rows older than a day) are purged in small batches,
--     opportunistically from the function itself (no scheduler dependency) and by a pg_cron job when that extension exists.
--  5. Index: the (event_type, created_at desc) index the global cap and the purge rely on is created idempotently so it is tracked.

create index if not exists system_events_type_idx on public.system_events(event_type, created_at desc);

revoke all on table public.system_events from anon, authenticated;

create table if not exists quizbox_private.auth_failure_budget (
 source text not null,
 window_start timestamptz not null,
 used integer not null default 0,
 primary key (source, window_start)
);
revoke all on table quizbox_private.auth_failure_budget from public, anon, authenticated;

create or replace function quizbox_private.purge_auth_failures(p_max_age interval default interval '30 days', p_batch integer default 500)
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 p_batch:=least(greatest(coalesce(p_batch,500),1),5000);
 delete from public.system_events where ctid in (
  select ctid from public.system_events where event_type='AUTH_FAILURE' and created_at<now()-p_max_age order by created_at limit p_batch);
 get diagnostics removed=row_count;
 delete from quizbox_private.auth_failure_budget where window_start<now()-interval '1 day';
 return removed;
end $$;
revoke all on function quizbox_private.purge_auth_failures(interval,integer) from public, anon, authenticated;

create or replace function public.qb_auth_failure(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare
 c text:=lower(btrim(coalesce(p_code,'')));
 headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 ip text;
 src text;
 win timestamptz:=date_trunc('minute',now());
 n integer;
begin
 -- bounded, opportunistic retention, run before any cap so it also happens during a flood (about 1 call in 50, one small batch)
 if random()<0.02 then perform quizbox_private.purge_auth_failures(); end if;
 ip:=nullif(btrim(headers->>'cf-connecting-ip'),'');
 if ip is null then ip:=nullif(btrim((regexp_split_to_array(coalesce(headers->>'x-forwarded-for',''),'\s*,\s*'))[array_length(regexp_split_to_array(coalesce(headers->>'x-forwarded-for',''),'\s*,\s*'),1)]),''); end if;
 src:=left(encode(extensions.digest(coalesce(ip,'unknown')||':'||current_date::text,'sha256'),'hex'),16);
 -- per-source cap first: a single source can never consume more than its share of the global cap
 insert into quizbox_private.auth_failure_budget(source,window_start,used) values(src,win,1)
  on conflict (source,window_start) do update set used=quizbox_private.auth_failure_budget.used+1 returning used into n;
 if n>10 then return; end if;
 if (select count(*) from public.system_events where event_type='AUTH_FAILURE' and created_at>now()-interval '1 minute')>=120 then return; end if;
 insert into public.system_events(event_type,entity_type,severity,details) values('AUTH_FAILURE','auth','warn',
  jsonb_build_object('code',case when c in (
   'invalid_credentials','email_not_confirmed','phone_not_confirmed','user_banned','user_not_found','over_request_rate_limit',
   'over_email_send_rate_limit','over_sms_send_rate_limit','captcha_failed','validation_failed','request_timeout','unexpected_failure',
   'session_expired','session_not_found','refresh_token_not_found','refresh_token_already_used','mfa_verification_failed',
   'mfa_challenge_expired','weak_password','signup_disabled','email_address_invalid','same_password','provider_disabled','bad_jwt'
  ) then c else 'AUTH_FAILED' end,'source',src));
end $$;

-- CREATE OR REPLACE keeps the ACL (postgres, anon, authenticated); PUBLIC remains revoked. Re-assert it defensively and idempotently.
revoke all on function public.qb_auth_failure(text) from public;
grant execute on function public.qb_auth_failure(text) to anon, authenticated;

-- Optional scheduler: when pg_cron is installed, also purge daily at 03:17 UTC. Absent or not permitted, the opportunistic purge still bounds retention.
do $cron$
begin
 if to_regnamespace('cron') is not null then
  perform cron.schedule('qb-purge-auth-failures','17 3 * * *',$job$select quizbox_private.purge_auth_failures(interval '30 days',5000)$job$);
 end if;
exception when others then
 raise notice 'pg_cron schedule skipped: %',sqlerrm;
end $cron$;

commit;
