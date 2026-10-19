-- Rollback for 20261023100000_challenges_moderation.sql. Removes reports and the moderation columns.
-- Afterwards re-apply 20261021100000_challenges_foundation.sql and 20261022100000_challenges_extensions.sql: they restore the earlier
-- qb_challenge_live, publish, finalize, award, public card and leaderboard functions.
drop function if exists public.challenge_report_resolve(uuid, text, text), public.challenge_reports_list(text), public.challenge_report(text, text, text), public.qb_challenge_notify(uuid, text, text, text, text);
drop table if exists public.challenge_reports;
alter table public.challenge_campaigns drop column if exists moderation_state, drop column if exists moderation_note;
