-- Topic registry: teachers teach topics and concepts, so questions are grouped that way (docs/question-loading/DESIGN.md, tracker T1/T2).
-- A topic is a teacher-language unit (one to three lessons) attached to one learning indicator; it has 1 to 12 concepts (3 to 8 advised) and a
-- block of questions (default 50). Purely additive: side tables only, the central questions table and every existing function are untouched.
-- Writes go through the security-definer functions below (content admins); authenticated users may read ACTIVE topics.
begin;

create table public.curriculum_topics (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id),
  indicator_node_id uuid not null references public.curriculum_nodes(id),
  title text not null check (length(btrim(title)) between 3 and 160),
  title_key text not null check (length(title_key) > 0),
  sort_order integer not null default 0,
  target_questions integer not null default 50 check (target_questions between 1 and 500),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (indicator_node_id, title_key)
);
create index curriculum_topics_curriculum_idx on public.curriculum_topics(curriculum_id, status, sort_order);

create table public.topic_concepts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.curriculum_topics(id),
  title text not null check (length(btrim(title)) between 2 and 120),
  title_key text not null,
  sort_order integer not null default 0,
  unique (topic_id, title_key)
);

create table public.question_topic_links (
  question_id uuid primary key references public.questions(id),
  topic_id uuid not null references public.curriculum_topics(id),
  concept_id uuid references public.topic_concepts(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index question_topic_links_topic_idx on public.question_topic_links(topic_id);
create index question_topic_links_concept_idx on public.question_topic_links(concept_id);

-- One row per loaded question file; the file hash makes the same file impossible to load twice.
create table public.question_load_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (length(file_name) between 1 and 300),
  file_sha256 text not null unique check (length(file_sha256) = 64),
  scope text not null check (scope in ('CURRICULUM', 'SPONSOR')),
  status text not null default 'CHECKED' check (status in ('CHECKED', 'LOADING', 'LOADED', 'PARTIAL', 'FAILED', 'REJECTED')),
  rows_total integer not null default 0 check (rows_total >= 0),
  rows_loaded integer not null default 0 check (rows_loaded >= 0),
  rows_rejected integer not null default 0 check (rows_rejected >= 0),
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object'),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.curriculum_topics enable row level security;
alter table public.topic_concepts enable row level security;
alter table public.question_topic_links enable row level security;
alter table public.question_load_batches enable row level security;

-- Learners and teachers read what is offered; content admins read everything.
create policy topics_read on public.curriculum_topics for select to authenticated
  using (status = 'ACTIVE' or quizbox_sme.has_capability('content_admin'));
create policy concepts_read on public.topic_concepts for select to authenticated
  using (exists (select 1 from public.curriculum_topics t where t.id = topic_id and (t.status = 'ACTIVE' or quizbox_sme.has_capability('content_admin'))));
create policy links_admin_read on public.question_topic_links for select to authenticated
  using (quizbox_sme.has_capability('content_admin'));
create policy batches_admin_read on public.question_load_batches for select to authenticated
  using (quizbox_sme.has_capability('content_admin'));

revoke all on public.curriculum_topics, public.topic_concepts, public.question_topic_links, public.question_load_batches from public, anon, authenticated;
grant select on public.curriculum_topics, public.topic_concepts, public.question_topic_links, public.question_load_batches to authenticated;

create or replace function public.qb_topic_normalise(p text) returns text language sql immutable set search_path = '' as $$
  select btrim(lower(regexp_replace(coalesce(p, ''), '[^[:alnum:]]+', ' ', 'g')));
$$;

-- Create or update a topic and its concepts. p = {indicator_node_id, title, concepts: [text], target_questions?, sort_order?}
create or replace function public.qb_topic_save(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.curriculum_nodes; t public.curriculum_topics; c text; i integer := 0; kept uuid[] := '{}'; cid uuid;
  concepts jsonb := coalesce(p -> 'concepts', '[]');
begin
  if auth.uid() is null or not quizbox_sme.has_capability('content_admin') then raise exception 'QB_TOPIC_ACCESS_DENIED' using errcode = '42501'; end if;
  select * into n from public.curriculum_nodes where id = (p ->> 'indicator_node_id')::uuid;
  if n.id is null or not n.is_active or n.node_type not in ('learning_indicator', 'learning_objective') then raise exception 'QB_TOPIC_INVALID_INDICATOR'; end if;
  if length(btrim(coalesce(p ->> 'title', ''))) not between 3 and 160 then raise exception 'QB_TOPIC_INVALID_TITLE'; end if;
  if jsonb_typeof(concepts) <> 'array' or jsonb_array_length(concepts) not between 1 and 12 then raise exception 'QB_TOPIC_INVALID_CONCEPTS'; end if;

  insert into public.curriculum_topics(curriculum_id, indicator_node_id, title, title_key, sort_order, target_questions, created_by)
  values (n.curriculum_id, n.id, btrim(p ->> 'title'), public.qb_topic_normalise(p ->> 'title'), coalesce((p ->> 'sort_order')::integer, 0),
          coalesce((p ->> 'target_questions')::integer, 50), auth.uid())
  on conflict (indicator_node_id, title_key) do update
    set title = excluded.title, sort_order = excluded.sort_order, target_questions = excluded.target_questions, updated_at = now()
  returning * into t;

  for c in select jsonb_array_elements_text(concepts) loop
    i := i + 1;
    if length(btrim(c)) not between 2 and 120 then raise exception 'QB_TOPIC_INVALID_CONCEPTS'; end if;
    insert into public.topic_concepts(topic_id, title, title_key, sort_order)
    values (t.id, btrim(c), public.qb_topic_normalise(c), i)
    on conflict (topic_id, title_key) do update set title = excluded.title, sort_order = excluded.sort_order
    returning id into cid;
    kept := kept || cid;
  end loop;
  -- A concept dropped from the list is removed only while no question points at it.
  delete from public.topic_concepts d where d.topic_id = t.id and not (d.id = any (kept))
    and not exists (select 1 from public.question_topic_links l where l.concept_id = d.id);
  return jsonb_build_object('topic_id', t.id, 'status', t.status, 'concepts', cardinality(kept));
end $$;

-- DRAFT -> ACTIVE (offered to teachers) -> RETIRED. Activation requires enough approved questions.
create or replace function public.qb_topic_set_status(p_topic uuid, p_status text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.curriculum_topics; approved integer;
begin
  if auth.uid() is null or not quizbox_sme.has_capability('content_admin') then raise exception 'QB_TOPIC_ACCESS_DENIED' using errcode = '42501'; end if;
  if p_status not in ('DRAFT', 'ACTIVE', 'RETIRED') then raise exception 'QB_TOPIC_INVALID_STATUS'; end if;
  select * into t from public.curriculum_topics where id = p_topic for update;
  if t.id is null then raise exception 'QB_TOPIC_NOT_FOUND'; end if;
  if p_status = 'ACTIVE' then
    select count(*) into approved from public.question_topic_links l join public.questions q on q.id = l.question_id
     where l.topic_id = t.id and q.status = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated');
    if approved < t.target_questions then raise exception 'QB_TOPIC_NOT_READY:%/%', approved, t.target_questions; end if;
  end if;
  update public.curriculum_topics set status = p_status, updated_at = now() where id = t.id;
  return jsonb_build_object('topic_id', t.id, 'status', p_status);
end $$;

-- Admin readiness view: per topic, approved questions against the target, by difficulty and by concept.
create or replace function public.qb_topic_readiness(p_curriculum uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not quizbox_sme.has_capability('content_admin') then raise exception 'QB_TOPIC_ACCESS_DENIED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'topic_id', t.id, 'title', t.title, 'status', t.status, 'indicator_code', n.code, 'target', t.target_questions,
      'approved', a.approved, 'easy', a.easy, 'medium', a.medium, 'hard', a.hard, 'ready', a.approved >= t.target_questions,
      'concepts', (select coalesce(jsonb_agg(jsonb_build_object('concept_id', c.id, 'title', c.title,
                     'approved', (select count(*) from public.question_topic_links l2 join public.questions q2 on q2.id = l2.question_id
                                   where l2.concept_id = c.id and q2.status = 'active' and lower(coalesce(q2.validation_status, '')) in ('approved', 'validated')))
                   order by c.sort_order), '[]') from public.topic_concepts c where c.topic_id = t.id)
    ) order by n.code, t.sort_order)
    from public.curriculum_topics t
    join public.curriculum_nodes n on n.id = t.indicator_node_id
    cross join lateral (
      select count(*) filter (where q.status = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated')) as approved,
             count(*) filter (where q.status = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and lower(coalesce(q.difficulty_label, '')) = 'easy') as easy,
             count(*) filter (where q.status = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and lower(coalesce(q.difficulty_label, '')) = 'medium') as medium,
             count(*) filter (where q.status = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and lower(coalesce(q.difficulty_label, '')) = 'hard') as hard
        from public.question_topic_links l join public.questions q on q.id = l.question_id where l.topic_id = t.id) a
    where t.curriculum_id = p_curriculum), '[]'::jsonb);
end $$;

revoke all on function public.qb_topic_normalise(text), public.qb_topic_save(jsonb), public.qb_topic_set_status(uuid, text), public.qb_topic_readiness(uuid) from public, anon;
grant execute on function public.qb_topic_normalise(text) to authenticated;
grant execute on function public.qb_topic_save(jsonb), public.qb_topic_set_status(uuid, text), public.qb_topic_readiness(uuid) to authenticated;

commit;
