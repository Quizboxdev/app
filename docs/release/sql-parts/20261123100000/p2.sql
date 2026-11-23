create or replace function public.qb_help_video_set_state(p_id uuid, p_state text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v public.help_videos;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_state not in ('draft', 'published') then raise exception 'QB_HELP_INVALID' using errcode = '22023'; end if;
  update public.help_videos set state = p_state, published_at = case when p_state = 'published' then coalesce(published_at, now()) else published_at end, updated_by = auth.uid(), updated_at = now()
   where id = p_id returning * into v;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('help.video.' || p_state, 'help_videos', v.id, jsonb_build_object('youtube_id', v.youtube_id));
  return jsonb_build_object('ok', true, 'state', v.state);
end $fn$;

create or replace function public.qb_help_video_delete(p_id uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare v public.help_videos;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into v from public.help_videos where id = p_id for update;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.state = 'published' then raise exception 'QB_HELP_UNPUBLISH_FIRST' using errcode = '55000'; end if;
  delete from public.help_videos where id = v.id;
  perform quizbox_core.audit('help.video.delete', 'help_videos', v.id, jsonb_build_object('youtube_id', v.youtube_id));
end $fn$;

revoke all on function public.qb_help_videos_for(text), public.qb_help_videos_list(text), public.qb_help_video_track(uuid, text), public.qb_help_video_outbound(uuid, boolean), public.qb_help_video_admin_list(),
  public.qb_help_video_save(uuid, text, text, text, text[], integer, integer, text[]), public.qb_help_video_set_state(uuid, text), public.qb_help_video_delete(uuid) from public, anon, authenticated;
grant execute on function public.qb_help_videos_for(text), public.qb_help_videos_list(text) to anon, authenticated, service_role;
grant execute on function public.qb_help_video_admin_list(), public.qb_help_video_save(uuid, text, text, text, text[], integer, integer, text[]), public.qb_help_video_set_state(uuid, text), public.qb_help_video_delete(uuid) to authenticated;
grant execute on function public.qb_help_video_track(uuid, text), public.qb_help_video_outbound(uuid, boolean) to service_role;


notify pgrst, 'reload schema';
