-- Rollback for 20261124120000_marketing_posts.sql. Removes every marketing post (links already shared will stop opening). Export first if you need the text:
-- select slug, title, summary, body from public.marketing_posts;
-- The flyer files in the marketing-posts storage bucket are left in place (delete them in Storage if you want them gone).
begin;
drop function if exists public.qb_post_delete(uuid);
drop function if exists public.qb_post_set_state(uuid, text);
drop function if exists public.qb_post_save(uuid, text, text, text, text, text, text);
drop function if exists public.qb_post_admin_get(uuid);
drop function if exists public.qb_post_admin_list();
drop function if exists public.qb_post_list();
drop function if exists public.qb_post_get(text);
drop table if exists public.marketing_posts;
commit;
notify pgrst, 'reload schema';
