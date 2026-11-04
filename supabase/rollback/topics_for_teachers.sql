-- Rollback for 20261056100000_topics_for_teachers.sql: removes the two admin functions. Topics already opened stay open (that is data; withdraw them with
-- qb_topic_set_status or an update on curriculum_topics if needed), and audit_logs rows written by the functions are kept.
begin;
drop function if exists public.qb_topics_set_open(boolean, text, text);
drop function if exists public.qb_topics_overview();
commit;
