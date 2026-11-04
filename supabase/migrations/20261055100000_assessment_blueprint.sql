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
begin;

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

-- Chooses p_share questions of one topic: difficulty split (30 / 40 / 30 unless a level is asked for), one question per concept before a second of any, random within that,
-- never one already chosen (p_exclude). Returns the ids and the split. A topic that cannot supply the share raises QB_TOPIC_SHORT.
create or replace function quizbox_topic.pick_for_topic(p_topic uuid, p_title text, p_share integer, p_difficulty text, p_tenant uuid, p_acc boolean, p_exclude uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare av_e integer; av_m integer; av_h integer; av_t integer; tgt_e integer; tgt_m integer; tgt_h integer; tk_e integer; tk_m integer; tk_h integer; short integer; add_n integer; picked uuid[];
begin
  select count(*) filter (where e.level = 'easy'), count(*) filter (where e.level = 'medium'), count(*) filter (where e.level = 'hard'), count(*)
    into av_e, av_m, av_h, av_t from quizbox_topic.listable_questions(p_topic, p_tenant, p_acc) e where not (e.question_id = any (p_exclude));
  if p_difficulty is not null then
    tgt_e := case when p_difficulty = 'easy' then p_share else 0 end;
    tgt_m := case when p_difficulty = 'medium' then p_share else 0 end;
    tgt_h := case when p_difficulty = 'hard' then p_share else 0 end;
  else
    tgt_e := round(p_share * 0.3); tgt_h := round(p_share * 0.3); tgt_m := p_share - tgt_e - tgt_h;
  end if;
  tk_e := least(tgt_e, av_e); tk_m := least(tgt_m, av_m); tk_h := least(tgt_h, av_h);
  short := p_share - (tk_e + tk_m + tk_h);
  if short > 0 and p_difficulty is null then   -- a level is thin: fill from medium first, then easy, then hard
    add_n := least(short, av_m - tk_m); tk_m := tk_m + add_n; short := short - add_n;
    add_n := least(short, av_e - tk_e); tk_e := tk_e + add_n; short := short - add_n;
    add_n := least(short, av_h - tk_h); tk_h := tk_h + add_n; short := short - add_n;
  end if;
  if short > 0 then
    raise exception 'QB_TOPIC_SHORT: % has % available%, % needed', p_title,
      case when p_difficulty is null then av_t else case p_difficulty when 'easy' then av_e when 'medium' then av_m else av_h end end,
      case when p_difficulty is null then '' else ' at ' || p_difficulty || ' level' end, p_share;
  end if;
  -- A few spare candidates per level so a question the full check refuses is replaced; the full check runs on candidates only.
  with e as (select l.question_id, l.level, l.concept_id from quizbox_topic.listable_questions(p_topic, p_tenant, p_acc) l where not (l.question_id = any (p_exclude))),
  ranked as (select e.question_id, e.level, row_number() over (partition by e.level, e.concept_id order by random()) as rr from e),
  ordered as (select r.question_id, r.level, row_number() over (partition by r.level order by r.rr, random()) as pos from ranked r),
  cand as (select o.question_id, o.level, o.pos from ordered o
            where (o.level = 'easy' and tk_e > 0 and o.pos <= tk_e + 4) or (o.level = 'medium' and tk_m > 0 and o.pos <= tk_m + 4) or (o.level = 'hard' and tk_h > 0 and o.pos <= tk_h + 4)),
  ok as (select c.question_id, c.level, c.pos from cand c where (select public.qb_question_is_available(q) from public.questions q where q.id = c.question_id)),
  numbered as (select k.question_id, k.level, row_number() over (partition by k.level order by k.pos) as n from ok k)
  select coalesce(array_agg(n.question_id), '{}') into picked from numbered n
   where (n.level = 'easy' and n.n <= tk_e) or (n.level = 'medium' and n.n <= tk_m) or (n.level = 'hard' and n.n <= tk_h);
  if cardinality(picked) <> p_share then raise exception 'QB_TOPIC_SHORT: % has % available, % needed', p_title, cardinality(picked), p_share; end if;
  return jsonb_build_object('picked', to_jsonb(picked), 'available', av_t, 'easy', tk_e, 'medium', tk_m, 'hard', tk_h);
end $fn$;

-- The blueprint selection. Returns sections, flat topic shares and the chosen question ids; the public preview hides the ids.
create or replace function quizbox_topic.blueprint_plan(p_class uuid, p_sections jsonb, p_difficulty text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c public.classes; acc boolean; n_sections integer; total integer := 0; sec jsonb; pos integer := 0; subj text; quota integer; sec_diff text; explicit boolean;
  tids uuid[]; k integer; base integer; rem integer; t record; v_share integer; spare integer; allocated integer; tp integer; avail_all integer;
  picked jsonb; all_ids uuid[] := '{}'; sections_out jsonb := '[]'; shares jsonb := '[]'; nodes uuid[] := '{}'; grades text[] := '{}'; topic_out jsonb;
  seen text[] := '{}'; target_grade text;
begin
  c := quizbox_topic.class_for_teacher(p_class);
  acc := c.class_name = 'QuizBox Developer Acceptance Class';
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then raise exception 'QB_BLUEPRINT_INVALID'; end if;
  n_sections := jsonb_array_length(p_sections);
  if n_sections < 1 or n_sections > 8 then raise exception 'QB_BLUEPRINT_SECTIONS_INVALID'; end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then raise exception 'QB_TOPIC_DIFFICULTY_INVALID'; end if;
  for sec in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(sec) <> 'object' or btrim(coalesce(sec ->> 'subject', '')) = '' or coalesce(sec ->> 'quota', '') !~ '^[0-9]{1,3}$' then raise exception 'QB_BLUEPRINT_INVALID'; end if;
    if (sec ->> 'quota')::integer < 1 then raise exception 'QB_BLUEPRINT_INVALID'; end if;
    if btrim(sec ->> 'subject') = any (seen) then raise exception 'QB_BLUEPRINT_DUPLICATE_SUBJECT'; end if;
    seen := seen || btrim(sec ->> 'subject');
    total := total + (sec ->> 'quota')::integer;
  end loop;
  if total < 1 or total > 100 then raise exception 'QB_TOPIC_TOTAL_INVALID'; end if;
  -- Several subjects in one quiz: Primary and JHS classes only.
  if n_sections > 1 and quizbox_topic.class_level(coalesce(nullif(c.grade_code, ''), c.grade::text), c.education_level) not in ('PRIMARY', 'JHS') then
    raise exception 'QB_COMBINED_LEVEL_NOT_ALLOWED';
  end if;

  -- The grade of the quiz: that of the first topic a section names, otherwise the class's own grade (B10 is the legacy code for SHS1). "Any topic" sections stay inside it.
  select coalesce(n.canonical_grade_code, n.grade_code) into target_grade from public.curriculum_topics x join public.curriculum_nodes n on n.id = x.indicator_node_id
   where x.id::text = (select s ->> 0 from (select sx -> 'topic_ids' as s from jsonb_array_elements(p_sections) sx where jsonb_typeof(sx -> 'topic_ids') = 'array' and jsonb_array_length(sx -> 'topic_ids') > 0 limit 1) f);
  if target_grade is null then
    target_grade := upper(coalesce(nullif(c.grade_code, ''), c.grade::text));
    if target_grade = 'B10' then target_grade := 'SHS1'; end if;
  end if;

  for sec in select value from jsonb_array_elements(p_sections) loop
    pos := pos + 1;
    subj := btrim(sec ->> 'subject'); quota := (sec ->> 'quota')::integer;
    sec_diff := coalesce(nullif(sec ->> 'difficulty', ''), p_difficulty);
    if sec_diff is not null and sec_diff not in ('easy', 'medium', 'hard') then raise exception 'QB_TOPIC_DIFFICULTY_INVALID'; end if;
    explicit := jsonb_typeof(sec -> 'topic_ids') = 'array' and jsonb_array_length(sec -> 'topic_ids') > 0;
    if explicit then
      select array_agg(distinct x::uuid) into tids from jsonb_array_elements_text(sec -> 'topic_ids') x;
      k := coalesce(cardinality(tids), 0);
      if k < 1 or k > 20 then raise exception 'QB_TOPIC_COUNT_INVALID'; end if;
      if (select count(*) from public.curriculum_topics x join public.curriculum_nodes n on n.id = x.indicator_node_id
           where x.id = any (tids) and x.status = 'ACTIVE' and x.curriculum_id = c.curriculum_id and n.subject_code = subj) <> k then
        raise exception 'QB_TOPIC_UNAVAILABLE';
      end if;
      if quota < k then raise exception 'QB_BLUEPRINT_QUOTA_TOO_SMALL: % needs at least % questions for % topics', subj, k, k; end if;
    else
      select coalesce(array_agg(z.id), '{}') into tids from (
        select x.id from public.curriculum_topics x join public.curriculum_nodes n on n.id = x.indicator_node_id
         where x.status = 'ACTIVE' and x.curriculum_id = c.curriculum_id and n.subject_code = subj and coalesce(n.canonical_grade_code, n.grade_code) = target_grade
           and exists (select 1 from quizbox_topic.listable_questions(x.id, c.tenant_id, acc))
         order by random() limit least(quota, 10)) z;
      k := coalesce(cardinality(tids), 0);
      if k < 1 then raise exception 'QB_TOPIC_UNAVAILABLE'; end if;
    end if;

    -- How the quota is spread over this section's topics.
    topic_out := '[]'; allocated := 0;
    if explicit then
      base := quota / k; rem := quota % k; tp := 0;
      for t in select tp2.id, tp2.title, tp2.indicator_node_id, (select count(*) from quizbox_topic.listable_questions(tp2.id, c.tenant_id, acc))::integer as available,
                      (select coalesce(n.canonical_grade_code, n.grade_code) from public.curriculum_nodes n where n.id = tp2.indicator_node_id) as grade
                 from public.curriculum_topics tp2 where tp2.id = any (tids) order by available desc, tp2.title, tp2.id loop
        tp := tp + 1;
        v_share := base + case when tp <= rem then 1 else 0 end;
        picked := quizbox_topic.pick_for_topic(t.id, t.title, v_share, sec_diff, c.tenant_id, acc, all_ids);
        all_ids := all_ids || array(select jsonb_array_elements_text(picked -> 'picked'))::uuid[];
        if not t.indicator_node_id = any (nodes) then nodes := nodes || t.indicator_node_id; end if;
        if t.grade is not null and not t.grade = any (grades) then grades := grades || t.grade; end if;
        topic_out := topic_out || jsonb_build_object('topic_id', t.id, 'title', t.title, 'share', v_share, 'available', t.available, 'easy', picked -> 'easy', 'medium', picked -> 'medium', 'hard', picked -> 'hard');
        shares := shares || jsonb_build_object('topic_id', t.id, 'share', v_share);
      end loop;
    else
      -- "Any topic": spread one question at a time over the chosen topics, never past what a topic holds, so a thin topic hands the rest to the others.
      select coalesce(sum(a), 0) into avail_all from (select (select count(*) from quizbox_topic.listable_questions(x, c.tenant_id, acc))::integer as a from unnest(tids) x) y;
      if avail_all < quota then raise exception 'QB_TOPIC_SHORT: % has % available, % needed', subj, avail_all, quota; end if;
      create temporary table if not exists qb_bp_alloc(topic_id uuid primary key, title text, indicator_node_id uuid, grade text, available integer, share integer) on commit drop;
      delete from qb_bp_alloc;
      insert into qb_bp_alloc select tp2.id, tp2.title, tp2.indicator_node_id, (select coalesce(n.canonical_grade_code, n.grade_code) from public.curriculum_nodes n where n.id = tp2.indicator_node_id),
             (select count(*) from quizbox_topic.listable_questions(tp2.id, c.tenant_id, acc))::integer, 0 from public.curriculum_topics tp2 where tp2.id = any (tids);
      spare := quota;
      while spare > 0 loop
        update qb_bp_alloc set share = share + 1 where topic_id in (select topic_id from qb_bp_alloc where share < available order by share, available desc, topic_id limit spare);
        get diagnostics allocated = row_count;
        exit when allocated = 0;
        spare := spare - allocated;
      end loop;
      for t in select * from qb_bp_alloc where share > 0 order by available desc, title, topic_id loop
        picked := quizbox_topic.pick_for_topic(t.topic_id, t.title, t.share, sec_diff, c.tenant_id, acc, all_ids);
        all_ids := all_ids || array(select jsonb_array_elements_text(picked -> 'picked'))::uuid[];
        if not t.indicator_node_id = any (nodes) then nodes := nodes || t.indicator_node_id; end if;
        if t.grade is not null and not t.grade = any (grades) then grades := grades || t.grade; end if;
        topic_out := topic_out || jsonb_build_object('topic_id', t.topic_id, 'title', t.title, 'share', t.share, 'available', t.available, 'easy', picked -> 'easy', 'medium', picked -> 'medium', 'hard', picked -> 'hard');
        shares := shares || jsonb_build_object('topic_id', t.topic_id, 'share', t.share);
      end loop;
    end if;
    sections_out := sections_out || jsonb_build_object('position', pos, 'subject', subj, 'quota', quota, 'topics', topic_out);
  end loop;

  if cardinality(grades) > 1 then raise exception 'QB_BLUEPRINT_ONE_GRADE'; end if;
  return jsonb_build_object('total', total, 'sections', sections_out, 'shares', shares, 'question_ids', to_jsonb(all_ids), 'node_ids', to_jsonb(nodes));
end $fn$;

-- Preview for the teacher: the split and what each topic can supply, without choosing questions for the learner to see.
create or replace function public.qb_blueprint_plan(p_class_id uuid, p_sections jsonb, p_difficulty text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  return quizbox_topic.blueprint_plan(p_class_id, p_sections, p_difficulty) - 'question_ids' - 'node_ids' - 'shares';
end $fn$;

create or replace function public.qb_publish_blueprint_assignment(
  p_class_id uuid, p_title text, p_description text, p_sections jsonb, p_difficulty text default null,
  p_mode text default 'ASSESSMENT', p_attempts_allowed integer default 1, p_time_limit_minutes integer default 30,
  p_start_at timestamptz default now(), p_due_at timestamptz default null, p_target_student_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare plan jsonb; published jsonb; aid uuid;
begin
  plan := quizbox_topic.blueprint_plan(p_class_id, p_sections, p_difficulty);
  published := public.qb_publish_assignment(p_class_id, p_title, p_description,
    array(select jsonb_array_elements_text(plan -> 'node_ids'))::uuid[], (plan ->> 'total')::integer, null, 'MANUAL',
    array(select jsonb_array_elements_text(plan -> 'question_ids'))::uuid[], p_mode, p_attempts_allowed, p_time_limit_minutes,
    p_start_at, p_due_at, p_target_student_ids, null, null);
  aid := (published ->> 'assignment_id')::uuid;
  insert into public.assignment_topics(assignment_id, topic_id, question_share)
  select aid, (s ->> 'topic_id')::uuid, (s ->> 'share')::integer from jsonb_array_elements(plan -> 'shares') s;
  insert into public.assignment_sections(assignment_id, position, subject, quota)
  select aid, (s ->> 'position')::integer, s ->> 'subject', (s ->> 'quota')::integer from jsonb_array_elements(plan -> 'sections') s;
  return published || jsonb_build_object('sections', plan -> 'sections');
end $fn$;

-- A learner's own result by subject and by topic, with the weakest topics, for any assessment. Unanswered questions count as not correct.
-- A question's subject is its own subject; its topic is its registered topic (a question without one is counted in the subject only).
create or replace function public.qb_attempt_breakdown(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare a public.attempts; result jsonb;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.attempts where id = p_attempt;
  if a.id is null or a.student_user_id is distinct from auth.uid() then raise exception 'ATTEMPT_NOT_FOUND' using errcode = '42501'; end if;
  with qs as (
    select aq.question_id, coalesce(nullif(btrim(q.subject_code), ''), 'Other') as subject, l.topic_id, t.title as topic_title,
           coalesce((select bool_or(coalesce(r.is_correct, false)) from public.responses r where r.attempt_id = a.id and r.question_id = aq.question_id), false) as correct
      from public.assessment_questions aq join public.questions q on q.id = aq.question_id
      left join public.question_topic_links l on l.question_id = q.id left join public.curriculum_topics t on t.id = l.topic_id
     where aq.assessment_id = a.assessment_id),
  subj as (select subject, count(*)::integer as total, count(*) filter (where correct)::integer as correct from qs group by subject),
  tops as (select subject, topic_id, topic_title, count(*)::integer as total, count(*) filter (where correct)::integer as correct from qs where topic_id is not null group by subject, topic_id, topic_title)
  select jsonb_build_object(
    'attempt_id', a.id,
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('subject', s.subject, 'position', (select sc.position from public.assignment_sections sc where sc.assignment_id = a.assignment_id and sc.subject = s.subject), 'total', s.total, 'correct', s.correct, 'percent', round(100.0 * s.correct / s.total),
        'topics', coalesce((select jsonb_agg(jsonb_build_object('topic_id', t.topic_id, 'title', t.topic_title, 'total', t.total, 'correct', t.correct, 'percent', round(100.0 * t.correct / t.total)) order by round(100.0 * t.correct / t.total), t.topic_title)
                              from tops t where t.subject = s.subject), '[]'::jsonb))
        order by round(100.0 * s.correct / s.total), s.subject) from subj s), '[]'::jsonb),
    'weakest', coalesce((select jsonb_agg(jsonb_build_object('subject', w.subject, 'topic_id', w.topic_id, 'title', w.topic_title, 'correct', w.correct, 'total', w.total, 'percent', round(100.0 * w.correct / w.total)))
                         from (select * from tops order by (correct::numeric / total), total desc, topic_title limit 3) w where w.correct < w.total), '[]'::jsonb)) into result;
  return result;
end $fn$;

revoke all on function quizbox_topic.class_level(text, text), quizbox_topic.listable_questions(uuid, uuid, boolean), quizbox_topic.pick_for_topic(uuid, text, integer, text, uuid, boolean, uuid[]),
  quizbox_topic.blueprint_plan(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.qb_teacher_topics(uuid, text), public.qb_blueprint_plan(uuid, jsonb, text),
  public.qb_publish_blueprint_assignment(uuid, text, text, jsonb, text, text, integer, integer, timestamptz, timestamptz, uuid[]), public.qb_attempt_breakdown(uuid) from public, anon;
grant execute on function public.qb_teacher_topics(uuid, text), public.qb_blueprint_plan(uuid, jsonb, text),
  public.qb_publish_blueprint_assignment(uuid, text, text, jsonb, text, text, integer, integer, timestamptz, timestamptz, uuid[]), public.qb_attempt_breakdown(uuid) to authenticated;

commit;
