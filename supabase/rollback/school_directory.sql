-- Rollback for 20261074100000_school_directory.sql: switches the feature off and removes its functions. The tables and the school_directory_id columns are kept, so no school or link is lost.
begin;

update public.platform_settings set value = 'false'::jsonb where key = 'flags.school_directory' and scope_type = 'global';

drop function if exists public.qb_school_admin_import(jsonb, text);
drop function if exists public.qb_school_admin_update(uuid, jsonb);
drop function if exists public.qb_school_admin_decide(uuid, text, text, uuid, jsonb);
drop function if exists public.qb_school_apply_fix(uuid, jsonb);
drop function if exists public.qb_school_admin_list(text, text, integer, integer);
drop function if exists public.qb_school_set_mine(uuid);
drop function if exists public.qb_school_submit(text, text, text, text, text[], text, text);
drop function if exists public.qb_school_search(text, text, text, text, text, integer, text);
drop function if exists public.qb_school_districts(text, text, text, text);
drop function if exists public.qb_school_regions(text, text, text);
drop function if exists public.qb_school_clean_name(text);
drop function if exists public.qb_school_regions_gh();
drop function if exists public.qb_school_directory_on();
drop function if exists public.qb_school_district_key(text);
drop function if exists public.qb_school_key(text);

commit;
