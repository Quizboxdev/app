-- Rolls back 20261012140000_topic_assignment.sql. Assignments already published stay as they are (they are ordinary MANUAL assignments);
-- only the record of which topics each covered is dropped.
begin;
drop function if exists public.qb_publish_topic_assignment(uuid, text, text, uuid[], integer, text, text, integer, integer, timestamptz, timestamptz, uuid[]);
drop function if exists public.qb_topic_assignment_plan(uuid, uuid[], integer, text);
drop function if exists public.qb_teacher_topics(uuid, text);
drop function if exists quizbox_topic.assignment_plan(uuid, uuid[], integer, text);
drop function if exists quizbox_topic.ancestor_title(uuid, text);
drop function if exists quizbox_topic.eligible_questions(uuid, uuid, boolean);
drop function if exists quizbox_topic.class_for_teacher(uuid);
drop table if exists public.assignment_topics;
drop schema if exists quizbox_topic;
commit;
