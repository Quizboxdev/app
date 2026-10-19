-- Rollback for 20261019140000_study_mode. Sessions already built stay as ordinary practice sets.
drop function if exists public.qb_start_study_session(uuid, integer, text);
drop function if exists public.qb_topic_progress(uuid[]);
