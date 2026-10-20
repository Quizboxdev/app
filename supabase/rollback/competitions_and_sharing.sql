-- Rollback for 20261027100000_competitions_and_sharing.sql. Removes the new functions. The new columns (format, audience_*, advance_top_n) are left in place so no data is lost.
-- Afterwards re-apply, in order: 20261018100000_access_gate_standalone.sql (free allowance), 20261021100000_challenges_foundation.sql, 20261022100000_challenges_extensions.sql and
-- 20261023100000_challenges_moderation.sql. They restore the earlier create, rounds, start, publish, leaderboard, list, card and creator functions, the allowance counting
-- (practice only) and the teacher/sponsor-only creator rule. Competitions already created then behave as single-round challenges.
drop function if exists public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text);
drop function if exists public.challenge_public_list(integer, integer, text);
drop function if exists public.challenge_set_audience(uuid, uuid, uuid), public.challenge_my_audiences(), public.challenge_track_share(text);
drop function if exists public.qb_challenge_cleared(uuid, integer, uuid), public.qb_challenge_stage_rank(uuid, integer, uuid), public.qb_challenge_in_audience(public.challenge_campaigns),
  public.qb_challenge_school_admin(uuid), public.qb_challenge_allowance_blocked(uuid), public.qb_free_sessions_used(uuid);
