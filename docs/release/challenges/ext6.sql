create or replace function public.challenge_analytics(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; out jsonb;
begin
  c := public.qb_challenge_owned(p_id);
  select jsonb_build_object(
    'views', (select count(*) from public.challenge_events e where e.campaign_id = p_id and e.event = 'campaign_viewed'),
    'started', (select count(*) from public.challenge_attempts a where a.campaign_id = p_id),
    'players', (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = p_id),
    'completed', (select count(*) from public.challenge_attempts a where a.campaign_id = p_id and a.submitted_at is not null and not a.expired),
    'expired', (select count(*) from public.challenge_attempts a where a.campaign_id = p_id and a.expired),
    'avg_score_percent', (select round(avg(100.0 * a.score / nullif(a.max_score, 0)), 1) from public.challenge_attempts a where a.campaign_id = p_id and a.submitted_at is not null and not a.expired),
    'avg_duration_ms', (select round(avg(a.duration_ms)) from public.challenge_attempts a where a.campaign_id = p_id and a.submitted_at is not null and not a.expired),
    'distribution', (select coalesce(jsonb_agg(jsonb_build_object('band', b.band, 'count', b.n) order by b.band), '[]'::jsonb) from (
        select (least(floor(100.0 * a.score / nullif(a.max_score, 0) / 20), 4) * 20)::int as band, count(*) as n
          from public.challenge_attempts a where a.campaign_id = p_id and a.submitted_at is not null and not a.expired and a.max_score > 0 group by 1) b),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('stage_no', g.stage_no, 'started', coalesce(x.started, 0), 'completed', coalesce(x.completed, 0), 'players', coalesce(x.players, 0)) order by g.stage_no), '[]'::jsonb)
        from generate_series(1, c.stage_count) g(stage_no) left join (
          select a.stage_no, count(*) as started, count(*) filter (where a.submitted_at is not null and not a.expired) as completed, count(distinct a.user_id) as players
            from public.challenge_attempts a where a.campaign_id = p_id group by a.stage_no) x on x.stage_no = g.stage_no),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('position', q.position, 'stage_no', q.stage_no, 'text', left(q.question_text, 90), 'answered', coalesce(s.answered, 0), 'percent_correct', s.pct) order by q.position), '[]'::jsonb)
        from public.challenge_questions q left join (
          select r.question_id, count(*) filter (where r.chosen_index is not null) as answered, round(100.0 * count(*) filter (where r.is_correct) / nullif(count(*), 0), 1) as pct
            from public.challenge_responses r join public.challenge_attempts a on a.id = r.attempt_id where a.campaign_id = p_id group by r.question_id) s on s.question_id = q.id
        where q.campaign_id = p_id),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'starts', d.n) order by d.day), '[]'::jsonb) from (
        select (a.started_at at time zone 'UTC')::date as day, count(*) as n from public.challenge_attempts a where a.campaign_id = p_id and a.started_at > now() - interval '30 days' group by 1) d)
  ) into out;
  return out;
end $fn$;

create or replace function public.challenge_admin_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'campaigns', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) as n from public.challenge_campaigns group by status) s),
    'attempts_30d', (select count(*) from public.challenge_attempts where started_at > now() - interval '30 days'),
    'players_30d', (select count(distinct user_id) from public.challenge_attempts where started_at > now() - interval '30 days'),
    'awards_pending', (select count(*) from public.challenge_awards where status in ('PENDING','CONTACTED')),
    'top', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select c.slug, c.title, c.status, count(distinct a.user_id) as players from public.challenge_campaigns c left join public.challenge_attempts a on a.campaign_id = c.id
         group by c.id order by players desc, c.created_at desc limit 10) t));
end $fn$;

-- 11. Grants.
revoke all on function public.challenge_set_stages(uuid, jsonb), public.challenge_my_progress(text), public.challenge_set_questions(uuid, jsonb), public.challenge_pull_bank(uuid, text, text, integer, integer),
  public.challenge_publish(uuid), public.challenge_creator_get(uuid), public.challenge_public_list(integer, integer), public.challenge_public_get(text), public.challenge_start(text, text, integer),
  public.challenge_leaderboard(text, integer), public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid), public.challenge_content_list(uuid), public.challenge_content_chunks(uuid, uuid, integer, integer),
  public.challenge_set_prizes(uuid, jsonb), public.challenge_finalize(uuid), public.challenge_awards_list(uuid), public.challenge_award_update(uuid, text, text), public.challenge_my_awards(),
  public.challenge_set_brand(uuid, jsonb), public.challenge_track_view(text), public.challenge_analytics(uuid), public.challenge_admin_overview() from public, anon, authenticated;
grant execute on function public.challenge_public_list(integer, integer), public.challenge_public_get(text), public.challenge_leaderboard(text, integer) to authenticated, service_role;
grant execute on function public.challenge_track_view(text) to service_role;
grant execute on function public.challenge_set_stages(uuid, jsonb), public.challenge_my_progress(text), public.challenge_set_questions(uuid, jsonb), public.challenge_pull_bank(uuid, text, text, integer, integer),
  public.challenge_publish(uuid), public.challenge_creator_get(uuid), public.challenge_start(text, text, integer), public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid),
  public.challenge_content_list(uuid), public.challenge_content_chunks(uuid, uuid, integer, integer), public.challenge_set_prizes(uuid, jsonb), public.challenge_finalize(uuid), public.challenge_awards_list(uuid),
  public.challenge_award_update(uuid, text, text), public.challenge_my_awards(), public.challenge_set_brand(uuid, jsonb), public.challenge_analytics(uuid), public.challenge_admin_overview() to authenticated;

