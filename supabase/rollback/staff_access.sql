-- Rollback for 20261070100000_staff_access.sql: the Staff access screen's functions and the flag row are removed.
-- Access already given stays: it is stored as ordinary capabilities (content_admin, sme_support, finance_admin) and keeps working. To withdraw one, set that capability inactive in public.user_capabilities.
begin;
drop function if exists public.qb_staff_set(uuid, text[]);
drop function if exists public.qb_staff_find(text);
drop function if exists public.qb_staff_list();
drop function if exists public.qb_my_staff_access();
drop function if exists quizbox_staff.guard();
drop function if exists quizbox_staff.workflows_of(uuid);
drop function if exists quizbox_staff.capability_of(text);
drop schema if exists quizbox_staff;
delete from public.platform_settings where key = 'flags.staff_access' and scope_type = 'global';
commit;
notify pgrst, 'reload schema';
