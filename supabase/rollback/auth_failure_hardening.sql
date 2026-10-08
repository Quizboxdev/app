-- Rollback for 20261010110000_auth_failure_hardening.sql. Restores the previous qb_auth_failure body (free-text code, single global cap).
-- It deliberately does NOT re-grant table privileges on public.system_events to anon/authenticated: that grant was a security defect (including TRUNCATE) and
-- restoring it is not part of a functional rollback. Nothing in the application reads or writes system_events directly; only definer functions do.
-- The private budget table, the purge function and the (event_type, created_at) index are left in place; they are inert once the function no longer calls them.
begin;

create or replace function public.qb_auth_failure(p_code text) returns void language plpgsql security definer set search_path='' as $$
begin
 if (select count(*) from public.system_events where event_type='AUTH_FAILURE' and created_at>now()-interval '1 minute')>=120 then return; end if;
 insert into public.system_events(event_type,entity_type,severity,details) values('AUTH_FAILURE','auth','warn',jsonb_build_object('code',case when p_code ~ '^[A-Za-z_ ]{3,60}$' then left(p_code,60) else 'AUTH_FAILED' end));
end $$;

-- Remove the optional pg_cron job when present (no-op otherwise).
do $cron$
begin
 if to_regnamespace('cron') is not null then perform cron.unschedule('qb-purge-auth-failures'); end if;
exception when others then raise notice 'pg_cron unschedule skipped: %',sqlerrm;
end $cron$;

commit;
