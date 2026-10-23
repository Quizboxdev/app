-- Rollback for 20261039100000_help_centre.sql (and the guides seeded by 20261040100000_help_seed_v1.sql). Removes the Help centre articles and their counters. Export first if you edited any guide:
-- select slug, title, body from public.help_articles;
begin;
drop function if exists public.qb_help_delete(uuid);
drop function if exists public.qb_help_set_state(uuid, text);
drop function if exists public.qb_help_save(uuid, text, text, text, text, text, text[], integer);
drop function if exists public.qb_help_admin_get(uuid);
drop function if exists public.qb_help_admin_list();
drop function if exists public.qb_help_track(text, text);
drop function if exists public.qb_help_search(text, text);
drop function if exists public.qb_help_get(text);
drop function if exists public.qb_help_list(text);
drop table if exists public.help_articles;
commit;
notify pgrst, 'reload schema';
