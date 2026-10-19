-- Rollback for 20261022100000_challenges_extensions.sql. Deletes stages, uploaded source passages, prizes, awards and branding.
-- Afterwards re-apply 20261021100000_challenges_foundation.sql: it restores the single-round versions of the functions replaced here (it is safe to re-run).
drop function if exists public.challenge_admin_overview(), public.challenge_analytics(uuid), public.challenge_track_view(text), public.challenge_set_brand(uuid, jsonb), public.challenge_my_awards(),
  public.challenge_award_update(uuid, text, text), public.challenge_awards_list(uuid), public.challenge_finalize(uuid), public.challenge_set_prizes(uuid, jsonb),
  public.challenge_content_chunks(uuid, uuid, integer, integer), public.challenge_content_list(uuid),
  public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid), public.challenge_my_progress(text), public.challenge_set_stages(uuid, jsonb),
  public.challenge_start(text, text, integer), public.challenge_pull_bank(uuid, text, text, integer, integer),
  public.qb_challenge_norm(text), public.qb_challenge_ranking(uuid), public.qb_challenge_stage(uuid, integer);
alter table public.challenge_questions drop constraint if exists challenge_questions_chunk_fk;
drop table if exists public.challenge_awards, public.challenge_prizes, public.challenge_source_chunks, public.challenge_content_versions, public.challenge_content_assets, public.challenge_stages;
delete from public.challenge_events where event in ('campaign_finalized','award_issued','content_added');
alter table public.challenge_events drop constraint if exists challenge_events_event_check;
alter table public.challenge_events add constraint challenge_events_event_check check (event in
  ('campaign_published','campaign_paused','campaign_completed','campaign_viewed','attempt_started','attempt_submitted','campaign_shared'));
delete from public.challenge_attempts where stage_no <> 1;
delete from public.challenge_questions where stage_no <> 1;
alter table public.challenge_attempts drop constraint if exists challenge_attempts_stage_unique;
alter table public.challenge_attempts drop column if exists stage_no;
alter table public.challenge_attempts add constraint challenge_attempts_campaign_id_user_id_attempt_no_key unique (campaign_id, user_id, attempt_no);
alter table public.challenge_questions drop column if exists stage_no, drop column if exists source_chunk_id, drop column if exists source_quote;
alter table public.challenge_campaigns drop column if exists brand, drop column if exists stage_count, drop column if exists finalized_at;
-- now re-apply supabase/migrations/20261021100000_challenges_foundation.sql
