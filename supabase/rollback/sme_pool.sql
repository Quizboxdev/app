-- Rolls back 20261012130000_sme_pool.sql. Open pool picks stay as ordinary review assignments (the column is only a marker).
-- The notification trigger function keeps the self-pick guard; restoring the old body is not needed because admin assignments set assigned_by to the admin.
begin;
drop function if exists public.qb_sme_pool_settings(jsonb);
drop function if exists public.qb_sme_pool_sweep();
drop function if exists public.qb_sme_release(uuid,text);
drop function if exists public.qb_sme_pick(integer,text,text);
drop function if exists public.qb_sme_pool();
drop function if exists quizbox_sme.pool_require_reviewer();
drop function if exists quizbox_sme.pool_release_stale();
drop function if exists quizbox_sme.pool_candidates(uuid,text,text,integer,boolean);
drop function if exists quizbox_sme.safe_policy(uuid,uuid,text,text,text);
drop function if exists quizbox_sme.pool_day_start(uuid);
drop function if exists quizbox_sme.pool_number(text,integer);
drop table if exists quizbox_sme.pool_settings;
drop index if exists public.sme_assignments_pool_open;
alter table public.sme_review_assignments drop column if exists picked_from_pool;
commit;
