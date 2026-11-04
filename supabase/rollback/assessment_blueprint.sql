-- Rollback for 20261055100000_assessment_blueprint.sql: removes the blueprint functions and the cheap topic helpers and puts qb_teacher_topics back exactly as it was
-- (counts every question with the full availability check). The table assignment_sections is left in place on purpose (it is data: the subjects and quotas of any
-- blueprint assignment already published); drop it by hand only if no such assignment exists. qb_topic_assignment_plan / qb_publish_topic_assignment were never touched.
begin;

create or replace function public.qb_teacher_topics(p_class_id uuid, p_subject text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.classes; acc boolean;
begin
  c := quizbox_topic.class_for_teacher(p_class_id);
  acc := c.class_name = 'QuizBox Developer Acceptance Class';
  return coalesce((select jsonb_agg(r.j order by r.subject, r.grade, r.strand, r.sort_order, r.title) from (
    select n.subject_code as subject, coalesce(n.canonical_grade_code, n.grade_code) as grade, quizbox_topic.ancestor_title(n.id, 'strand') as strand, t.sort_order, t.title,
      jsonb_build_object('topic_id', t.id, 'title', t.title, 'subject', n.subject_code, 'grade', coalesce(n.canonical_grade_code, n.grade_code),
        'strand', quizbox_topic.ancestor_title(n.id, 'strand'), 'sub_strand', quizbox_topic.ancestor_title(n.id, 'sub_strand'),
        'indicator_code', n.code, 'indicator', n.title,
        'concepts', (select coalesce(jsonb_agg(k.title order by k.sort_order), '[]') from public.topic_concepts k where k.topic_id = t.id),
        'available', a.total, 'easy', a.easy, 'medium', a.medium, 'hard', a.hard) as j
    from public.curriculum_topics t join public.curriculum_nodes n on n.id = t.indicator_node_id
    cross join lateral (select count(*)::integer total, count(*) filter (where e.level = 'easy')::integer easy, count(*) filter (where e.level = 'medium')::integer medium,
        count(*) filter (where e.level = 'hard')::integer hard from quizbox_topic.eligible_questions(t.id, c.tenant_id, acc) e) a
    where t.curriculum_id = c.curriculum_id and t.status = 'ACTIVE' and (p_subject is null or n.subject_code = p_subject)
    limit 500) r), '[]'::jsonb);
end $$;

drop function if exists public.qb_attempt_breakdown(uuid);
drop function if exists public.qb_publish_blueprint_assignment(uuid, text, text, jsonb, text, text, integer, integer, timestamptz, timestamptz, uuid[]);
drop function if exists public.qb_blueprint_plan(uuid, jsonb, text);
drop function if exists quizbox_topic.blueprint_plan(uuid, jsonb, text);
drop function if exists quizbox_topic.pick_for_topic(uuid, text, integer, text, uuid, boolean, uuid[]);
drop function if exists quizbox_topic.listable_questions(uuid, uuid, boolean);
drop function if exists quizbox_topic.class_level(text, text);

commit;
