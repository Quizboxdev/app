-- Assessment blueprint: a quiz built from sections, each with its own subject, topics and quantity (for example Mathematics 10, Science 8, English 12).
-- Why: the teacher "assign by topic" screen and the plan behind it handled several topics but only inside ONE subject, and a basic-school or JHS teacher who teaches
-- several subjects to one class could not set a combined test. This adds:
--   * qb_blueprint_plan / qb_publish_blueprint_assignment: sections of {subject, quota, topic_ids (or null = any topic of the subject), difficulty (optional)}.
--     Within a section the quota is spread evenly across its topics (the remainder goes to the topics with the most questions); a section that names its topics is blocked
--     if a topic cannot supply its share (decision D-14, no silent redistribution); a section left on "any topic" picks topics itself and may spill into topics that have more.
--     Rules: 1 to 8 sections, one section per subject, 1 to 100 questions in all, one grade across the whole quiz, and a quiz with MORE THAN ONE subject only for a class at
--     Primary or JHS level (a Senior High class is limited to one subject). Publishing reuses qb_publish_assignment in MANUAL mode, so grading, targets and market checks are unchanged.
--   * assignment_sections: the subjects and quotas of a published assignment, for the results breakdown.
--   * qb_attempt_breakdown: for a learner's own attempt, the score per subject and per topic and the weakest topics (any assessment, not only blueprints).
--   * a faster teacher topic list: counts use a cheap column check instead of re-validating every question (about 4 ms each, as fixed for the learner's subject list in
--     20261053100000); the full availability check runs only on the questions actually chosen.
-- Additive: qb_topic_assignment_plan / qb_publish_topic_assignment are untouched. Replaces qb_teacher_topics with the same output. Rollback: supabase/rollback/assessment_blueprint.sql.


create table if not exists public.assignment_sections (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  position integer not null check (position >= 1),
  subject text not null check (length(btrim(subject)) between 1 and 120),
  quota integer not null check (quota >= 1),
  primary key (assignment_id, position)
);
alter table public.assignment_sections enable row level security;
revoke all on public.assignment_sections from anon, authenticated;

-- PRIMARY (B1 to B6), JHS (B7 to B9), SHS (B10 / SHS1 to SHS3) from the class's level code; the class's education level is only used when the code is not one of these.
create or replace function quizbox_topic.class_level(p_grade text, p_education_level text) returns text
language sql immutable set search_path = '' as $fn$
  select case
    when upper(btrim(coalesce(p_grade, ''))) ~ '^B[1-6]$' then 'PRIMARY'
    when upper(btrim(coalesce(p_grade, ''))) ~ '^B[7-9]$' then 'JHS'
    when upper(btrim(coalesce(p_grade, ''))) ~ '^(B10|SHS ?[1-3])$' then 'SHS'
    when lower(coalesce(p_education_level, '')) ~ 'primary' then 'PRIMARY'
    when lower(coalesce(p_education_level, '')) ~ '(jhs|junior)' then 'JHS'
    when lower(coalesce(p_education_level, '')) ~ '(shs|senior)' then 'SHS'
    else 'OTHER' end
$fn$;

-- Questions of a topic by plain column checks only (active, approved, owner rules). Used for counting and for choosing candidates; the full availability check
-- (qb_question_is_available, expensive) is applied to the chosen questions in pick_for_topic.
create or replace function quizbox_topic.listable_questions(p_topic uuid, p_tenant uuid, p_acceptance boolean)
returns table(question_id uuid, concept_id uuid, level text) language sql stable security definer set search_path = '' as $fn$
  select q.id, l.concept_id, lower(coalesce(nullif(q.difficulty_label, ''), q.difficulty_code, ''))
  from public.question_topic_links l join public.questions q on q.id = l.question_id
  where l.topic_id = p_topic and public.qb_question_is_listable(q) and (q.tenant_id is null or q.tenant_id = p_tenant)
    and (coalesce(q.source_type, '') not in ('DEV_ACCEPTANCE_FIXTURE', 'DEV_FACTORY_PILOT') or p_acceptance)
$fn$;

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
        count(*) filter (where e.level = 'hard')::integer hard from quizbox_topic.listable_questions(t.id, c.tenant_id, acc) e) a
    where t.curriculum_id = c.curriculum_id and t.status = 'ACTIVE' and (p_subject is null or n.subject_code = p_subject)
    limit 500) r), '[]'::jsonb);
end $$;
