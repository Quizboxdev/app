-- Rollback for 20261021100000_challenges_foundation.sql. Deletes every campaign, attempt and leaderboard row. Take a backup first if any campaign is live.
drop function if exists public.challenge_my_attempts(), public.challenge_leaderboard(text, integer), public.challenge_submit(uuid, jsonb), public.challenge_start(text, text),
  public.challenge_creator_get(uuid), public.challenge_my_campaigns(), public.challenge_set_status(uuid, text), public.challenge_publish(uuid),
  public.challenge_pull_bank(uuid, text, text, integer), public.challenge_set_questions(uuid, jsonb), public.challenge_update(uuid, jsonb),
  public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text), public.challenge_public_get(text), public.challenge_public_list(integer, integer),
  public.qb_challenge_owned(uuid), public.qb_challenge_event(uuid, text), public.qb_challenge_audit(text, uuid, jsonb), public.qb_challenge_live(public.challenge_campaigns),
  public.qb_challenge_creator(), public.qb_challenge_admin(), public.qb_challenge_active_user();
drop table if exists public.challenge_events, public.challenge_responses, public.challenge_attempts, public.challenge_questions, public.challenge_campaigns;
delete from public.user_capabilities where capability in ('campaign_creator','campaign_admin');
alter table public.user_capabilities drop constraint if exists user_capabilities_capability_check;
alter table public.user_capabilities add constraint user_capabilities_capability_check check (capability in (
  'super_admin','content_admin','sme_reviewer','senior_sme_reviewer','competition_admin','sponsor_admin','finance_admin','platform_admin','content_manager',
  'competition_manager','support_agent','school_admin','school_owner','sponsor_user','parent_guardian','senior_reviewer','sme_support'));
