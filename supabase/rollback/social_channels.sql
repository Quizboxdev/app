-- Rollback for 20261076100000_social_channels.sql: switches the feature off and removes its functions. The social_channels table is kept, so the list is not lost.
begin;

update public.platform_settings set value = 'false'::jsonb where key = 'flags.social_channels' and scope_type = 'global';

drop function if exists public.qb_social_admin_reorder(uuid[]);
drop function if exists public.qb_social_admin_delete(uuid);
drop function if exists public.qb_social_admin_save(jsonb);
drop function if exists public.qb_social_admin_list();
drop function if exists public.qb_social_channels();
drop function if exists public.qb_social_link(text, text);

commit;
