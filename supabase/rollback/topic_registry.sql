-- Rolls back 20261012100000_topic_registry.sql. Drops only objects that migration created.
begin;
drop function if exists public.qb_topic_readiness(uuid);
drop function if exists public.qb_topic_set_status(uuid, text);
drop function if exists public.qb_topic_save(jsonb);
drop function if exists public.qb_topic_normalise(text);
drop table if exists public.question_load_batches;
drop table if exists public.question_topic_links;
drop table if exists public.topic_concepts;
drop table if exists public.curriculum_topics;
commit;
