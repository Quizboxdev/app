begin;

-- Teacher assignment by topic (tracker T3). A teacher ticks topics under a subject and chooses a total; the questions are spread evenly
-- across the topics (the remainder goes to the topics with the most approved questions), each topic's share is drawn across difficulty
-- levels and across the topic's concepts, and nothing repeats. A topic that cannot supply its share blocks the assignment (decision D-14):
-- no silent redistribution. Publishing reuses qb_publish_assignment in MANUAL mode so grading, targets and market checks are unchanged.

create schema if not exists quizbox_topic;
revoke all on schema quizbox_topic from public, anon, authenticated;

-- Which topics an assignment covers and each topic's share, for understanding-per-concept reporting (T5).
create table public.assignment_topics (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  topic_id uuid not null references public.curriculum_topics(id),
  question_share integer not null check (question_share >= 1),
  created_at timestamptz not null default now(),
  primary key (assignment_id, topic_id)
);
create index assignment_topics_topic_idx on public.assignment_topics(topic_id);
alter table public.assignment_topics enable row level security;
revoke all on public.assignment_topics from anon, authenticated;

create function quizbox_topic.class_for_teacher(p_class uuid) returns public.classes
language plpgsql stable security definer set search_path = '' as $$
declare c public.classes;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into c from public.classes where id = p_class;
  if c.id is null then raise exception 'CLASS_NOT_FOUND'; end if;
  if not (c.teacher_user_id = auth.uid() or public.qb_can_manage_class(c.id)) then raise exception 'CLASS_ACCESS_DENIED' using errcode = '42501'; end if;
  return c;
end $$;

-- Approved, active, available questions of a topic: the same test the publisher applies, so a plan never picks what the publisher would refuse.
create function quizbox_topic.eligible_questions(p_topic uuid, p_tenant uuid, p_acceptance boolean)
returns table(question_id uuid, concept_id uuid, level text) language sql stable security definer set search_path = '' as $$
  select q.id, l.concept_id, lower(coalesce(nullif(q.difficulty_label, ''), q.difficulty_code, ''))
  from public.question_topic_links l join public.questions q on q.id = l.question_id
  where l.topic_id = p_topic and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated')
    and public.qb_question_is_available(q) and (q.tenant_id is null or q.tenant_id = p_tenant)
    and (coalesce(q.source_type, '') not in ('DEV_ACCEPTANCE_FIXTURE', 'DEV_FACTORY_PILOT') or p_acceptance);
$$;

create function quizbox_topic.ancestor_title(p_node uuid, p_type text) returns text language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select n.id, n.parent_id, n.node_type, n.title, 0 as depth from public.curriculum_nodes n where n.id = p_node
    union all
    select p.id, p.parent_id, p.node_type, p.title, up.depth + 1 from public.curriculum_nodes p join up on p.id = up.parent_id where up.depth < 8)
  select title from up where node_type = p_type order by depth limit 1;
$$;

-- The even-spread selection. Returns the shares and the chosen question ids; the public preview hides the ids.
create function quizbox_topic.assignment_plan(p_class uuid, p_topics uuid[], p_total integer, p_difficulty text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.classes; acc boolean; ids uuid[]; k integer; base integer; rem integer; t record; share integer; pos integer := 0;
  tgt_e integer; tgt_m integer; tgt_h integer; av_e integer; av_m integer; av_h integer; tk_e integer; tk_m integer; tk_h integer; short integer; add_n integer;
  picked uuid[]; all_ids uuid[] := '{}'; shares jsonb := '[]'; nodes uuid[] := '{}';
begin
  c := quizbox_topic.class_for_teacher(p_class);
  acc := c.class_name = 'QuizBox Developer Acceptance Class';
  select array_agg(distinct x) into ids from unnest(coalesce(p_topics, '{}')) x;
  k := coalesce(cardinality(ids), 0);
  if k < 1 or k > 20 then raise exception 'QB_TOPIC_COUNT_INVALID'; end if;
  if p_total is null or p_total < k or p_total > 100 then raise exception 'QB_TOPIC_TOTAL_INVALID'; end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then raise exception 'QB_TOPIC_DIFFICULTY_INVALID'; end if;
  if (select count(*) from public.curriculum_topics x where x.id = any(ids) and x.status = 'ACTIVE' and x.curriculum_id = c.curriculum_id) <> k then
    raise exception 'QB_TOPIC_UNAVAILABLE';
  end if;
  base := p_total / k; rem := p_total % k;

  for t in
    select tp.id, tp.title, tp.indicator_node_id, (select count(*) from quizbox_topic.eligible_questions(tp.id, c.tenant_id, acc))::integer as available
    from public.curriculum_topics tp where tp.id = any(ids) order by available desc, tp.title, tp.id
  loop
    pos := pos + 1;
    share := base + case when pos <= rem then 1 else 0 end;
    select count(*) filter (where level = 'easy'), count(*) filter (where level = 'medium'), count(*) filter (where level = 'hard')
      into av_e, av_m, av_h from quizbox_topic.eligible_questions(t.id, c.tenant_id, acc);
    if p_difficulty is not null then
      tgt_e := case when p_difficulty = 'easy' then share else 0 end;
      tgt_m := case when p_difficulty = 'medium' then share else 0 end;
      tgt_h := case when p_difficulty = 'hard' then share else 0 end;
    else
      -- 30% easy, 40% medium, 30% hard of the topic's share (the 15 / 20 / 15 block shape).
      tgt_e := round(share * 0.3); tgt_h := round(share * 0.3); tgt_m := share - tgt_e - tgt_h;
    end if;
    tk_e := least(tgt_e, av_e); tk_m := least(tgt_m, av_m); tk_h := least(tgt_h, av_h);
    short := share - (tk_e + tk_m + tk_h);
    if short > 0 and p_difficulty is null then
      -- A level is thin: fill from medium first, then easy, then hard.
      add_n := least(short, av_m - tk_m); tk_m := tk_m + add_n; short := short - add_n;
      add_n := least(short, av_e - tk_e); tk_e := tk_e + add_n; short := short - add_n;
      add_n := least(short, av_h - tk_h); tk_h := tk_h + add_n; short := short - add_n;
    end if;
    if short > 0 then
      raise exception 'QB_TOPIC_SHORT: % has % available%, % needed', t.title,
        case when p_difficulty is null then t.available else case p_difficulty when 'easy' then av_e when 'medium' then av_m else av_h end end,
        case when p_difficulty is null then '' else ' at ' || p_difficulty || ' level' end, share;
    end if;

    -- One question per concept before a second of any: every concept of the topic is probed. Random within that.
    with e as (select question_id, level, concept_id from quizbox_topic.eligible_questions(t.id, c.tenant_id, acc)),
    ranked as (select e.question_id, e.level, row_number() over (partition by e.level, e.concept_id order by random()) as rr from e),
    ordered as (select r.question_id, r.level, row_number() over (partition by r.level order by r.rr, random()) as pos from ranked r)
    select coalesce(array_agg(o.question_id), '{}') into picked from ordered o
    where (o.level = 'easy' and o.pos <= tk_e) or (o.level = 'medium' and o.pos <= tk_m) or (o.level = 'hard' and o.pos <= tk_h);
    if cardinality(picked) <> share then raise exception 'QB_TOPIC_SHORT: % has % available, % needed', t.title, cardinality(picked), share; end if;

    all_ids := all_ids || picked;
    if not t.indicator_node_id = any(nodes) then nodes := nodes || t.indicator_node_id; end if;
    shares := shares || jsonb_build_object('topic_id', t.id, 'title', t.title, 'share', share, 'available', t.available, 'easy', tk_e, 'medium', tk_m, 'hard', tk_h);
  end loop;
  return jsonb_build_object('total', p_total, 'shares', shares, 'question_ids', to_jsonb(all_ids), 'node_ids', to_jsonb(nodes));
end $$;

-- The topics a teacher can set work on for a class: active topics of the class's curriculum, with what is available now.
create function public.qb_teacher_topics(p_class_id uuid, p_subject text default null) returns jsonb
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

-- Preview for the teacher: the split and what each topic can supply, without choosing questions.
create function public.qb_topic_assignment_plan(p_class_id uuid, p_topic_ids uuid[], p_total integer, p_difficulty text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return quizbox_topic.assignment_plan(p_class_id, p_topic_ids, p_total, p_difficulty) - 'question_ids' - 'node_ids';
end $$;

create function public.qb_publish_topic_assignment(
  p_class_id uuid, p_title text, p_description text, p_topic_ids uuid[], p_total integer, p_difficulty text default null,
  p_mode text default 'ASSESSMENT', p_attempts_allowed integer default 1, p_time_limit_minutes integer default 30,
  p_start_at timestamptz default now(), p_due_at timestamptz default null, p_target_student_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan jsonb; published jsonb; aid uuid;
begin
  plan := quizbox_topic.assignment_plan(p_class_id, p_topic_ids, p_total, p_difficulty);
  published := public.qb_publish_assignment(p_class_id, p_title, p_description,
    array(select jsonb_array_elements_text(plan -> 'node_ids'))::uuid[], p_total, null, 'MANUAL',
    array(select jsonb_array_elements_text(plan -> 'question_ids'))::uuid[], p_mode, p_attempts_allowed, p_time_limit_minutes,
    p_start_at, p_due_at, p_target_student_ids, null, null);
  aid := (published ->> 'assignment_id')::uuid;
  insert into public.assignment_topics(assignment_id, topic_id, question_share)
  select aid, (s ->> 'topic_id')::uuid, (s ->> 'share')::integer from jsonb_array_elements(plan -> 'shares') s;
  return published || jsonb_build_object('topics', plan -> 'shares');
end $$;

revoke all on function quizbox_topic.class_for_teacher(uuid), quizbox_topic.eligible_questions(uuid, uuid, boolean), quizbox_topic.ancestor_title(uuid, text),
  quizbox_topic.assignment_plan(uuid, uuid[], integer, text) from public, anon, authenticated;
revoke all on function public.qb_teacher_topics(uuid, text), public.qb_topic_assignment_plan(uuid, uuid[], integer, text),
  public.qb_publish_topic_assignment(uuid, text, text, uuid[], integer, text, text, integer, integer, timestamptz, timestamptz, uuid[]) from public, anon;
grant execute on function public.qb_teacher_topics(uuid, text), public.qb_topic_assignment_plan(uuid, uuid[], integer, text),
  public.qb_publish_topic_assignment(uuid, text, text, uuid[], integer, text, text, integer, integer, timestamptz, timestamptz, uuid[]) to authenticated;

commit;
