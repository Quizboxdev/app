begin;
-- The creator of a challenge or competition can now see how many attempts each participant made, next to their best score.
-- The public leaderboard keeps showing the best score only. This list is for the creator (and platform admins), so it carries the same short names as the leaderboard.
-- One new read-only function; no table changes.
-- Rollback: supabase/rollback/challenge_participants.sql

create or replace function public.challenge_participants(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  c := public.qb_challenge_owned(p_id);
  return jsonb_build_object(
    'max_attempts', c.max_attempts,
    'rows', coalesce((select jsonb_agg(row_to_json(t) order by t.best_score desc nulls last, t.last_started desc) from (
      select split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end as name,
             count(*)::int as attempts,
             count(*) filter (where a.submitted_at is not null and not a.expired)::int as finished,
             max(a.score) filter (where a.submitted_at is not null and not a.expired) as best_score,
             max(a.max_score) filter (where a.submitted_at is not null and not a.expired) as max_score,
             max(a.started_at) as last_started
        from public.challenge_attempts a join public.profiles p on p.id = a.user_id
       where a.campaign_id = p_id
       group by a.user_id, p.full_name
       limit 500) t), '[]'::jsonb));
end $fn$;

revoke all on function public.challenge_participants(uuid) from public, anon;
grant execute on function public.challenge_participants(uuid) to authenticated;
commit;
