-- Rolls back 20261012190000_public_platform_stats.sql (function only; no data is touched).
begin;
drop function if exists public.qb_public_platform_stats();
commit;
