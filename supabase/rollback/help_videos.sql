-- Rollback for 20261123100000_help_videos.sql. Removes the Help video library (the videos, their links to guides and their play and click counters). The Help guides are not touched.
-- Export first if you want to keep the list: select title, youtube_id, plays, outbound from public.help_videos;
begin;
drop function if exists public.qb_help_video_delete(uuid);
drop function if exists public.qb_help_video_set_state(uuid, text);
drop function if exists public.qb_help_video_save(uuid, text, text, text, text[], integer, integer, text[]);
drop function if exists public.qb_help_video_admin_list();
drop function if exists public.qb_help_video_outbound(uuid, boolean);
drop function if exists public.qb_help_video_track(uuid, text);
drop function if exists public.qb_help_videos_list(text);
drop function if exists public.qb_help_videos_for(text);
drop table if exists public.help_video_links;
drop table if exists public.help_videos;
commit;
notify pgrst, 'reload schema';
