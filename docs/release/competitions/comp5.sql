create or replace function public.challenge_my_campaigns() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
    select c.id, c.slug, c.title, c.status, c.visibility, c.category, c.format, c.stage_count, c.question_count, c.starts_at, c.ends_at, c.created_at,
           (c.audience_class_id is not null or c.audience_institution_id is not null) as has_audience,
           (select count(*) from public.challenge_questions q where q.campaign_id = c.id) as questions_loaded,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants,
           c.access_code
      from public.challenge_campaigns c where c.owner_id = auth.uid() or public.qb_challenge_admin() order by c.created_at desc limit 200) t), '[]'::jsonb);
end $fn$;

-- 10. Sharing is counted (server route with the service role, so a visitor who is not signed in can share too).
create or replace function public.challenge_track_share(p_slug text) returns void language sql security definer set search_path = '' as $fn$
  insert into public.challenge_events(campaign_id, user_id, event) select c.id, auth.uid(), 'campaign_shared' from public.challenge_campaigns c
   where c.slug = lower(btrim(p_slug)) and c.status in ('LIVE','PAUSED','COMPLETED') and c.visibility <> 'PRIVATE';
$fn$;

-- 11. Grants (nothing to anon; public pages read through the service role).
revoke all on function public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text), public.challenge_set_audience(uuid, uuid, uuid),
  public.challenge_my_audiences(), public.challenge_set_stages(uuid, jsonb), public.challenge_my_progress(text), public.challenge_start(text, text, integer), public.challenge_publish(uuid),
  public.challenge_leaderboard(text, integer), public.challenge_public_list(integer, integer, text), public.challenge_public_get(text), public.challenge_my_campaigns(),
  public.challenge_track_share(text), public.qb_challenge_creator() from public, anon, authenticated;
grant execute on function public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text), public.challenge_set_audience(uuid, uuid, uuid),
  public.challenge_my_audiences(), public.challenge_set_stages(uuid, jsonb), public.challenge_my_progress(text), public.challenge_start(text, text, integer), public.challenge_publish(uuid),
  public.challenge_my_campaigns(), public.qb_challenge_creator() to authenticated;
grant execute on function public.challenge_leaderboard(text, integer), public.challenge_public_list(integer, integer, text), public.challenge_public_get(text) to authenticated, service_role;
grant execute on function public.challenge_track_share(text) to service_role;

notify pgrst, 'reload schema';

