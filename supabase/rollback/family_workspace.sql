-- Rollback for 20261079100000_family_workspace.sql: removes the functions and switches the flag off. The table and the two new columns stay, so no link is lost.
begin;
update public.platform_settings set value = 'false'::jsonb where key = 'flags.family_workspace' and scope_type = 'global';
drop function if exists public.qb_family_attach_child(uuid, uuid, text);
drop function if exists public.qb_family_revoke(uuid);
drop function if exists public.qb_family_child_summary(uuid);
drop function if exists public.qb_family_children();
drop function if exists public.qb_family_open(text);
drop function if exists public.qb_family_can(uuid, text);
drop function if exists quizbox_core.family_can(uuid, uuid, text);
drop function if exists quizbox_core.family_default_permissions(text);
commit;
