-- Mock exams, part 1 of 3: authoring. A teacher (or a verified organisation sponsor) builds a cumulative exam from rounds of
--   level/year -> subject -> topic -> number of questions
-- until the exam reaches its desired size. Questions come only from the chosen topic (approved and listable); a topic that cannot supply its share raises QB_TOPIC_SHORT and nothing is
-- added: no silent substitution from another topic or level. A question (or its duplicate group) can appear once. Publishing freezes an immutable version; editing a published exam is a draft
-- change until it is published again as the next version. Delivery (class assignment, marketplace, results) is in the next two migrations.
-- Off behind flags.mock_exams. Additive: new tables, new functions, one new schema (quizbox_mock). Browsers have no table access; every read and write goes through the functions below.
-- Errors: QB_AUTHENTICATION_REQUIRED, QB_FEATURE_DISABLED, QB_MOCK_AUTHOR_FORBIDDEN, QB_MOCK_SPONSOR_NOT_VERIFIED, QB_NOT_FOUND, QB_MOCK_INVALID, QB_MOCK_ARCHIVED, QB_MOCK_LEVEL_NOT_ELIGIBLE,
--   QB_MOCK_TOPIC_INVALID, QB_MOCK_TOPIC_CAP, QB_MOCK_TOPIC_IN_USE, QB_MOCK_OVER_ALLOCATED, QB_MOCK_TOO_MANY_ROUNDS, QB_MOCK_BELOW_ALLOCATED, QB_MOCK_CURRICULUM_LOCKED, QB_MOCK_ROUNDS_INELIGIBLE, QB_TOPIC_SHORT,
--   QB_MOCK_QUESTION_INVALID, QB_MOCK_NOT_READY, QB_MOCK_NO_CHANGES, QB_MOCK_NOT_DELETABLE, QB_MOCK_VERSION_IMMUTABLE.
-- Rollback: supabase/rollback/mock_exams_authoring.sql.
begin;

create schema if not exists quizbox_mock;
revoke all on schema quizbox_mock from public, anon, authenticated;

insert into public.platform_settings(key, value, description)
select v.key, v.value::jsonb, v.descr from (values
  ('flags.mock_exams', 'false', 'Mock exams: teachers and verified sponsors build cumulative exams from several years'),
  ('mock_exams.min_questions', '5', 'Fewest questions in a mock exam'),
  ('mock_exams.max_questions', '100', 'Most questions in a mock exam (the class publisher allows 100)'),
  ('mock_exams.max_per_topic', '10', 'Most questions one topic can contribute to a mock exam'),
  ('mock_exams.max_rounds', '30', 'Most allocation rounds in one mock exam'),
  ('mock_exams.export_row_limit', '50000', 'Most answer rows in one results export')) as v(key, value, descr)
where not exists (select 1 from public.platform_settings p where p.key = v.key and p.scope_type = 'global');

create table if not exists public.mock_exams (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  owner_kind text not null check (owner_kind in ('teacher', 'sponsor', 'staff')),
  title text not null check (length(btrim(title)) between 5 and 120),
  description text not null default '' check (length(description) <= 800),
  purpose text not null default 'practice' check (purpose in ('practice', 'promotion', 'end_of_term', 'bece_readiness', 'wassce_readiness', 'other')),
  audience text not null default '' check (length(audience) <= 200),
  curriculum_id uuid not null references public.curricula(id) on delete restrict,
  target_grade text not null check (target_grade ~ '^(B[1-9]|SHS[1-3])$'),
  desired_total integer not null check (desired_total between 1 and 100),
  time_limit_minutes integer not null default 60 check (time_limit_minutes between 5 and 300),
  attempts_allowed integer not null default 1 check (attempts_allowed between 1 and 3),
  shuffle_questions boolean not null default false,
  instructions text not null default '' check (length(instructions) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  dirty boolean not null default true,
  current_version_id uuid,
  version_count integer not null default 0 check (version_count >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index if not exists mock_exams_owner on public.mock_exams(owner_user_id, updated_at desc);

create table if not exists public.mock_exam_rounds (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.mock_exams(id) on delete cascade,
  position integer not null check (position >= 1),
  grade_code text not null check (grade_code ~ '^(B[1-9]|SHS[1-3])$'),
  subject_code text not null check (length(btrim(subject_code)) between 1 and 120),
  topic_id uuid not null references public.curriculum_topics(id) on delete restrict,
  requested integer not null check (requested between 1 and 100),
  created_at timestamptz not null default now(),
  unique (exam_id, position), unique (exam_id, topic_id)
);

create table if not exists public.mock_exam_questions (
  seq bigint generated always as identity,
  exam_id uuid not null references public.mock_exams(id) on delete cascade,
  round_id uuid not null references public.mock_exam_rounds(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  picked_by text not null default 'auto' check (picked_by in ('auto', 'manual')),
  primary key (exam_id, question_id)
);
create index if not exists mock_exam_questions_round on public.mock_exam_questions(round_id, seq);

create table if not exists public.mock_exam_versions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.mock_exams(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  published_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz not null default now(),
  title text not null, description text not null default '', purpose text not null, audience text not null default '',
  curriculum_id uuid not null, target_grade text not null,
  question_count integer not null check (question_count >= 1), total_marks numeric(10, 2) not null,
  time_limit_minutes integer not null, attempts_allowed integer not null, shuffle_questions boolean not null default false, instructions text not null default '',
  rounds jsonb not null, content_hash text not null,
  unique (exam_id, version_no)
);

create table if not exists public.mock_exam_version_questions (
  version_id uuid not null references public.mock_exam_versions(id) on delete restrict,
  position integer not null check (position >= 1),
  round_position integer not null,
  question_id uuid not null references public.questions(id) on delete restrict,
  question_version integer,
  topic_id uuid, grade_code text, subject_code text, curriculum_node_id uuid,
  external_id text, source_type text, source_version text, curriculum_reference text,
  question_text text not null, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text,
  answer_type text, answer_spec jsonb, question_content jsonb, marks numeric(8, 2) not null default 1,
  primary key (version_id, position), unique (version_id, question_id)
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'mock_exams_current_version_fk') then
    alter table public.mock_exams add constraint mock_exams_current_version_fk foreign key (current_version_id) references public.mock_exam_versions(id) on delete restrict;
  end if;
end $c$;

alter table public.mock_exams enable row level security; alter table public.mock_exam_rounds enable row level security; alter table public.mock_exam_questions enable row level security;
alter table public.mock_exam_versions enable row level security; alter table public.mock_exam_version_questions enable row level security;
revoke all on public.mock_exams, public.mock_exam_rounds, public.mock_exam_questions, public.mock_exam_versions, public.mock_exam_version_questions from anon, authenticated;

-- A published version never changes, so an attempt can always be read against what was published.
create or replace function quizbox_mock.freeze() returns trigger language plpgsql set search_path = '' as $fn$
begin raise exception 'QB_MOCK_VERSION_IMMUTABLE' using errcode = '55000'; end $fn$;
drop trigger if exists mock_exam_versions_freeze on public.mock_exam_versions;
create trigger mock_exam_versions_freeze before update or delete on public.mock_exam_versions for each row execute function quizbox_mock.freeze();
drop trigger if exists mock_exam_version_questions_freeze on public.mock_exam_version_questions;
create trigger mock_exam_version_questions_freeze before update or delete on public.mock_exam_version_questions for each row execute function quizbox_mock.freeze();

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function quizbox_mock.num(p_key text, p_default numeric) returns numeric language sql stable security definer set search_path = '' as $fn$
  select coalesce(nullif(quizbox_core.setting(p_key) #>> '{}', '')::numeric, p_default);
$fn$;

-- Levels in order. B10 is the legacy code for SHS 1.
create or replace function quizbox_mock.canon(p_grade text) returns text language sql immutable set search_path = '' as $fn$
  select case when upper(btrim(coalesce(p_grade, ''))) = 'B10' then 'SHS1' else upper(btrim(coalesce(p_grade, ''))) end
$fn$;
create or replace function quizbox_mock.grade_rank(p_grade text) returns integer language sql immutable set search_path = '' as $fn$
  select case quizbox_mock.canon(p_grade) when 'B1' then 1 when 'B2' then 2 when 'B3' then 3 when 'B4' then 4 when 'B5' then 5 when 'B6' then 6 when 'B7' then 7 when 'B8' then 8 when 'B9' then 9
    when 'SHS1' then 10 when 'SHS2' then 11 when 'SHS3' then 12 else null end
$fn$;
create or replace function quizbox_mock.stage(p_grade text) returns text language sql immutable set search_path = '' as $fn$
  select case when quizbox_mock.grade_rank(p_grade) between 1 and 6 then 'PRIMARY' when quizbox_mock.grade_rank(p_grade) between 7 and 9 then 'JHS' when quizbox_mock.grade_rank(p_grade) between 10 and 12 then 'SHS' end
$fn$;
-- A level may feed a target exam when it is in the same stage and not above the target year.
create or replace function quizbox_mock.eligible(p_target text, p_grade text) returns boolean language sql immutable set search_path = '' as $fn$
  select quizbox_mock.stage(p_target) is not null and quizbox_mock.stage(p_target) = quizbox_mock.stage(p_grade) and quizbox_mock.grade_rank(p_grade) <= quizbox_mock.grade_rank(p_target)
$fn$;

-- Who may author: an active teacher, an active organisation sponsor whose verification is VERIFIED, or staff.
create or replace function quizbox_mock.author_kind() returns text language plpgsql stable security definer set search_path = '' as $fn$
declare r text; st text;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not coalesce(quizbox_core.flag('flags.mock_exams'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select upper(p.role::text), lower(p.status::text) into r, st from public.profiles p where p.id = auth.uid();
  if st is distinct from 'active' then raise exception 'QB_MOCK_AUTHOR_FORBIDDEN' using errcode = '42501'; end if;
  if r = 'TEACHER' then return 'teacher'; end if;
  if r in ('ADMIN', 'OWNER') then return 'staff'; end if;
  if r = 'SPONSOR' then
    if exists (select 1 from public.sponsor_profiles s where s.user_id = auth.uid() and upper(coalesce(s.sponsor_type, 'ORGANIZATION')) = 'ORGANIZATION' and upper(coalesce(s.verification_status, '')) = 'VERIFIED' and lower(coalesce(s.status::text, 'active')) = 'active') then return 'sponsor'; end if;
    raise exception 'QB_MOCK_SPONSOR_NOT_VERIFIED' using errcode = '42501';
  end if;
  raise exception 'QB_MOCK_AUTHOR_FORBIDDEN' using errcode = '42501';
end $fn$;

-- A curriculum the author may use: active, and in the author's own market (any market when the profile has none).
create or replace function quizbox_mock.curriculum_ok(p_curriculum uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.curricula c join public.market_curricula mc on mc.curriculum_id = c.id and mc.active
                  where c.id = p_curriculum and c.status = 'ACTIVE'
                    and ((select p.default_market_id from public.profiles p where p.id = auth.uid()) is null or mc.market_id = (select p.default_market_id from public.profiles p where p.id = auth.uid())))
$fn$;

create or replace function quizbox_mock.own_exam(p_exam uuid, p_lock boolean default false) returns public.mock_exams language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams;
begin
  perform quizbox_mock.author_kind();
  if p_lock then select * into e from public.mock_exams where id = p_exam and owner_user_id = auth.uid() for update;
  else select * into e from public.mock_exams where id = p_exam and owner_user_id = auth.uid(); end if;
  if e.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return e;
end $fn$;

-- The identity of a question for duplicate checks: its duplicate group, else its text hash (the loader's own formula), else itself.
create or replace function quizbox_mock.dup_key(q public.questions) returns text language sql immutable set search_path = '' as $fn$
  select coalesce(q.duplicate_group_id, case when q.text_hash is not null then 'dup-' || q.text_hash end, q.id::text)
$fn$;

-- Every question id that may not be added again: the ones already in the exam, and any question that is a duplicate of one of them.
create or replace function quizbox_mock.taken(p_exam uuid) returns uuid[] language sql stable security definer set search_path = '' as $fn$
  with sel as (select q.id, q.text_hash, q.duplicate_group_id from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = p_exam)
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) from (
    select sel.id from sel
    union select q.id from public.questions q where q.text_hash = any (select text_hash from sel where text_hash is not null)                              -- indexed: same text
    union select q.id from public.questions q where q.duplicate_group_id = any (select duplicate_group_id from sel where duplicate_group_id is not null)  -- the loader's duplicate group
  ) x;
$fn$;

create or replace function quizbox_mock.subject_label(p_curriculum uuid, p_grade text, p_subject text) returns text language sql stable security definer set search_path = '' as $fn$
  select coalesce((select n.title from public.curriculum_nodes n where n.curriculum_id = p_curriculum and n.node_type = 'subject' and n.subject_code = p_subject
                    and quizbox_mock.canon(coalesce(n.canonical_grade_code, n.grade_code)) = quizbox_mock.canon(p_grade) order by n.sort_order limit 1), p_subject)
$fn$;

-- The state of every round: what was asked, what is chosen, what could still be added, and how many are missing for good.
create or replace function quizbox_mock.rounds_json(e public.mock_exams) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_taken uuid[] := quizbox_mock.taken(e.id); v_tenant uuid := public.qb_public_tenant_id();
begin
  return coalesce((select jsonb_agg(x.j order by x.position) from (
    select r.position, jsonb_build_object('id', r.id, 'position', r.position, 'grade_code', r.grade_code, 'subject_code', r.subject_code,
      'subject_label', quizbox_mock.subject_label(e.curriculum_id, r.grade_code, r.subject_code), 'topic_id', r.topic_id, 'topic_title', t.title,
      'strand', quizbox_topic.ancestor_title(t.indicator_node_id, 'strand'), 'indicator_code', n.code, 'requested', r.requested,
      'selected', coalesce(s.n, 0), 'available', a.total, 'available_to_add', a.free,
      'shortfall', greatest(r.requested - coalesce(s.n, 0) - a.free, 0)) as j
    from public.mock_exam_rounds r join public.curriculum_topics t on t.id = r.topic_id join public.curriculum_nodes n on n.id = t.indicator_node_id
    left join lateral (select count(*)::integer as n from public.mock_exam_questions q where q.round_id = r.id) s on true
    cross join lateral (select count(*)::integer as total, count(*) filter (where not (l.question_id = any (v_taken)))::integer as free from quizbox_topic.listable_questions(r.topic_id, v_tenant, false) l) a
    where r.exam_id = e.id) x), '[]'::jsonb);
end $fn$;

create or replace function quizbox_mock.totals(e public.mock_exams) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('desired', e.desired_total, 'allocated', coalesce((select sum(requested) from public.mock_exam_rounds where exam_id = e.id), 0)::integer,
    'selected', (select count(*) from public.mock_exam_questions where exam_id = e.id)::integer,
    'remaining_to_allocate', e.desired_total - coalesce((select sum(requested) from public.mock_exam_rounds where exam_id = e.id), 0)::integer,
    'remaining_to_select', coalesce((select sum(requested) from public.mock_exam_rounds where exam_id = e.id), 0)::integer - (select count(*) from public.mock_exam_questions where exam_id = e.id)::integer)
$fn$;

create or replace function quizbox_mock.exam_json(e public.mock_exams) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'purpose', e.purpose, 'audience', e.audience, 'curriculum_id', e.curriculum_id, 'target_grade', e.target_grade,
    'desired_total', e.desired_total, 'time_limit_minutes', e.time_limit_minutes, 'attempts_allowed', e.attempts_allowed, 'shuffle_questions', e.shuffle_questions, 'instructions', e.instructions,
    'status', e.status, 'dirty', e.dirty, 'owner_kind', e.owner_kind, 'version_count', e.version_count, 'current_version_id', e.current_version_id,
    'current_version_no', (select v.version_no from public.mock_exam_versions v where v.id = e.current_version_id), 'created_at', e.created_at, 'updated_at', e.updated_at,
    'rounds', quizbox_mock.rounds_json(e), 'totals', quizbox_mock.totals(e))
$fn$;

-- Is the exam ready to publish? Codes only; the screen words them.
create or replace function quizbox_mock.readiness(e public.mock_exams) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare issues jsonb := '[]'; t jsonb := quizbox_mock.totals(e); r record; bad integer; dup integer;
begin
  if e.desired_total < quizbox_mock.num('mock_exams.min_questions', 5) then issues := issues || jsonb_build_object('code', 'TOO_FEW_QUESTIONS', 'count', e.desired_total); end if;
  if not exists (select 1 from public.mock_exam_rounds where exam_id = e.id) then issues := issues || jsonb_build_object('code', 'NO_ROUNDS'); end if;
  if (t ->> 'allocated')::integer <> e.desired_total then issues := issues || jsonb_build_object('code', 'NOT_FULLY_ALLOCATED', 'count', e.desired_total - (t ->> 'allocated')::integer); end if;
  for r in select rr.position, rr.requested, (select count(*) from public.mock_exam_questions q where q.round_id = rr.id)::integer as n from public.mock_exam_rounds rr where rr.exam_id = e.id order by rr.position loop
    if r.n <> r.requested then issues := issues || jsonb_build_object('code', 'ROUND_NOT_FILLED', 'round', r.position, 'count', r.requested - r.n); end if;
  end loop;
  select count(*) into bad from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = e.id and not public.qb_question_is_available(q);
  if bad > 0 then issues := issues || jsonb_build_object('code', 'QUESTION_UNAVAILABLE', 'count', bad); end if;
  select count(*) - count(distinct quizbox_mock.dup_key(q)) into dup from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = e.id;
  if dup > 0 then issues := issues || jsonb_build_object('code', 'DUPLICATE_QUESTIONS', 'count', dup); end if;
  return jsonb_build_object('ready', jsonb_array_length(issues) = 0, 'issues', issues, 'totals', t);
end $fn$;

revoke all on function quizbox_mock.freeze(), quizbox_mock.num(text, numeric), quizbox_mock.canon(text), quizbox_mock.grade_rank(text), quizbox_mock.stage(text), quizbox_mock.eligible(text, text),
  quizbox_mock.author_kind(), quizbox_mock.curriculum_ok(uuid), quizbox_mock.own_exam(uuid, boolean), quizbox_mock.dup_key(public.questions), quizbox_mock.taken(uuid), quizbox_mock.subject_label(uuid, text, text),
  quizbox_mock.rounds_json(public.mock_exams), quizbox_mock.totals(public.mock_exams), quizbox_mock.exam_json(public.mock_exams), quizbox_mock.readiness(public.mock_exams) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Author: status, curricula and the level/subject/topic menu
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_enabled() returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce(quizbox_core.flag('flags.mock_exams'), false)
$fn$;

create or replace function public.qb_mock_author_status() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare k text;
begin
  begin
    k := quizbox_mock.author_kind();
    return jsonb_build_object('enabled', true, 'can_author', true, 'kind', k, 'reason', null);
  exception when others then
    return jsonb_build_object('enabled', coalesce(quizbox_core.flag('flags.mock_exams'), false), 'can_author', false, 'kind', null, 'reason', case when SQLERRM ~ '^QB_[A-Z_]+$' then SQLERRM else 'QB_MOCK_AUTHOR_FORBIDDEN' end);
  end;
end $fn$;

create or replace function public.qb_mock_curricula() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare m uuid;
begin
  perform quizbox_mock.author_kind();
  select default_market_id into m from public.profiles where id = auth.uid();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'version', c.version) order by c.name, c.version)
    from public.curricula c join public.market_curricula mc on mc.curriculum_id = c.id and mc.active where c.status = 'ACTIVE' and (m is null or mc.market_id = m)), '[]'::jsonb);
end $fn$;

-- The levels a target year may draw from, oldest first, and nothing else.
create or replace function public.qb_mock_grades(p_target text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_mock.author_kind();
  return coalesce((select jsonb_agg(g order by quizbox_mock.grade_rank(g)) from unnest(array['B1','B2','B3','B4','B5','B6','B7','B8','B9','SHS1','SHS2','SHS3']) g where quizbox_mock.eligible(p_target, g)), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mock_subjects(p_curriculum uuid, p_grade text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_mock.author_kind();
  if quizbox_mock.grade_rank(p_grade) is null then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('subject_code', s.subject_code, 'label', quizbox_mock.subject_label(p_curriculum, p_grade, s.subject_code), 'topics', s.n) order by quizbox_mock.subject_label(p_curriculum, p_grade, s.subject_code))
    from (select n.subject_code, count(*)::integer as n from public.curriculum_topics t join public.curriculum_nodes n on n.id = t.indicator_node_id
           where t.curriculum_id = p_curriculum and t.status = 'ACTIVE' and quizbox_mock.canon(coalesce(n.canonical_grade_code, n.grade_code)) = quizbox_mock.canon(p_grade) and n.subject_code is not null
           group by n.subject_code) s), '[]'::jsonb);
end $fn$;

-- Topics of one level and subject with how many approved questions each can still give this exam (questions already in it, and their duplicates, are not counted).
create or replace function public.qb_mock_topics(p_curriculum uuid, p_grade text, p_subject text, p_exam uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_taken uuid[] := '{}'; v_tenant uuid := public.qb_public_tenant_id();
begin
  perform quizbox_mock.author_kind();
  if p_exam is not null then
    perform quizbox_mock.own_exam(p_exam);
    v_taken := quizbox_mock.taken(p_exam);
  end if;
  return coalesce((select jsonb_agg(x.j order by x.sort_order, x.title) from (
    select t.sort_order, t.title, jsonb_build_object('topic_id', t.id, 'title', t.title, 'strand', quizbox_topic.ancestor_title(n.id, 'strand'), 'sub_strand', quizbox_topic.ancestor_title(n.id, 'sub_strand'),
      'indicator_code', n.code, 'available', a.total, 'available_to_add', a.free, 'easy', a.easy, 'medium', a.medium, 'hard', a.hard,
      'in_exam', exists (select 1 from public.mock_exam_rounds r where r.exam_id = p_exam and r.topic_id = t.id)) as j
    from public.curriculum_topics t join public.curriculum_nodes n on n.id = t.indicator_node_id
    cross join lateral (select count(*)::integer as total, count(*) filter (where not (e.question_id = any (v_taken)))::integer as free,
        count(*) filter (where e.level = 'easy')::integer as easy, count(*) filter (where e.level = 'medium')::integer as medium, count(*) filter (where e.level = 'hard')::integer as hard
        from quizbox_topic.listable_questions(t.id, v_tenant, false) e) a
    where t.curriculum_id = p_curriculum and t.status = 'ACTIVE' and n.subject_code = p_subject and quizbox_mock.canon(coalesce(n.canonical_grade_code, n.grade_code)) = quizbox_mock.canon(p_grade)
    limit 300) x), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The exam itself
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_exam_create(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k text := quizbox_mock.author_kind(); e public.mock_exams; v_min integer := quizbox_mock.num('mock_exams.min_questions', 5)::integer; v_max integer := quizbox_mock.num('mock_exams.max_questions', 100)::integer; v_total integer;
begin
  if jsonb_typeof(p) is distinct from 'object' or coalesce(p ->> 'desired_total', '') !~ '^[0-9]{1,3}$' then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  v_total := (p ->> 'desired_total')::integer;
  if v_total < v_min or v_total > v_max then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  if not quizbox_mock.curriculum_ok((p ->> 'curriculum_id')::uuid) then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  begin
    insert into public.mock_exams(owner_user_id, owner_kind, title, description, purpose, audience, curriculum_id, target_grade, desired_total, time_limit_minutes, attempts_allowed, shuffle_questions, instructions)
    values (auth.uid(), k, btrim(coalesce(p ->> 'title', '')), btrim(coalesce(p ->> 'description', '')), coalesce(nullif(p ->> 'purpose', ''), 'practice'), btrim(coalesce(p ->> 'audience', '')),
            (p ->> 'curriculum_id')::uuid, quizbox_mock.canon(p ->> 'target_grade'), v_total, coalesce(nullif(p ->> 'time_limit_minutes', '')::integer, 60), coalesce(nullif(p ->> 'attempts_allowed', '')::integer, 1),
            coalesce((p ->> 'shuffle_questions')::boolean, false), btrim(coalesce(p ->> 'instructions', '')))
    returning * into e;
  exception when check_violation or invalid_text_representation then raise exception 'QB_MOCK_INVALID' using errcode = '22023';
  end;
  perform quizbox_core.audit('mock_exam.create', 'mock_exams', e.id, jsonb_build_object('target_grade', e.target_grade));
  return quizbox_mock.exam_json(e);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'QB_MOCK_INVALID' using errcode = '22023';
end $fn$;

create or replace function public.qb_mock_exam_update(p_exam uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); n public.mock_exams; v_total integer; v_target text; v_alloc integer;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  v_total := coalesce(nullif(p ->> 'desired_total', '')::integer, e.desired_total);
  v_target := quizbox_mock.canon(coalesce(nullif(p ->> 'target_grade', ''), e.target_grade));
  if v_total < quizbox_mock.num('mock_exams.min_questions', 5) or v_total > quizbox_mock.num('mock_exams.max_questions', 100) then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  select coalesce(sum(requested), 0)::integer into v_alloc from public.mock_exam_rounds where exam_id = e.id;
  if v_total < v_alloc then raise exception 'QB_MOCK_BELOW_ALLOCATED' using errcode = '22023'; end if;
  if p ? 'curriculum_id' and (p ->> 'curriculum_id')::uuid is distinct from e.curriculum_id and v_alloc > 0 then raise exception 'QB_MOCK_CURRICULUM_LOCKED' using errcode = '55000'; end if;
  if p ? 'curriculum_id' and (p ->> 'curriculum_id')::uuid is distinct from e.curriculum_id and not quizbox_mock.curriculum_ok((p ->> 'curriculum_id')::uuid) then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  if v_target is distinct from e.target_grade and exists (select 1 from public.mock_exam_rounds r where r.exam_id = e.id and not quizbox_mock.eligible(v_target, r.grade_code)) then raise exception 'QB_MOCK_ROUNDS_INELIGIBLE' using errcode = '22023'; end if;
  begin
    update public.mock_exams set title = btrim(coalesce(p ->> 'title', title)), description = btrim(coalesce(p ->> 'description', description)), purpose = coalesce(nullif(p ->> 'purpose', ''), purpose),
      audience = btrim(coalesce(p ->> 'audience', audience)), curriculum_id = coalesce(nullif(p ->> 'curriculum_id', '')::uuid, curriculum_id), target_grade = v_target, desired_total = v_total,
      time_limit_minutes = coalesce(nullif(p ->> 'time_limit_minutes', '')::integer, time_limit_minutes), attempts_allowed = coalesce(nullif(p ->> 'attempts_allowed', '')::integer, attempts_allowed),
      shuffle_questions = coalesce((p ->> 'shuffle_questions')::boolean, shuffle_questions), instructions = btrim(coalesce(p ->> 'instructions', instructions)), dirty = true, updated_at = now()
     where id = e.id returning * into n;
  exception when check_violation or invalid_text_representation then raise exception 'QB_MOCK_INVALID' using errcode = '22023';
  end;
  return quizbox_mock.exam_json(n);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'QB_MOCK_INVALID' using errcode = '22023';
end $fn$;

create or replace function public.qb_mock_exam_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_mock.author_kind();
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'purpose', e.purpose, 'target_grade', e.target_grade, 'status', e.status, 'dirty', e.dirty, 'desired_total', e.desired_total,
      'selected', (select count(*) from public.mock_exam_questions q where q.exam_id = e.id), 'version_count', e.version_count, 'updated_at', e.updated_at) order by e.updated_at desc)
    from public.mock_exams e where e.owner_user_id = auth.uid()), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mock_exam_get(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam);
begin
  return quizbox_mock.exam_json(e) || jsonb_build_object('versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version_no', v.version_no, 'published_at', v.published_at, 'question_count', v.question_count, 'total_marks', v.total_marks) order by v.version_no desc)
    from public.mock_exam_versions v where v.exam_id = e.id), '[]'::jsonb));
end $fn$;

-- A draft that was never published and has nothing taking it can be removed; anything else is archived, never deleted.
create or replace function public.qb_mock_exam_delete(p_exam uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if e.version_count > 0 then raise exception 'QB_MOCK_NOT_DELETABLE' using errcode = '55000'; end if;
  delete from public.mock_exams where id = e.id;
  perform quizbox_core.audit('mock_exam.delete', 'mock_exams', e.id, '{}'::jsonb);
end $fn$;

create or replace function public.qb_mock_exam_archive(p_exam uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if e.status = 'archived' then return quizbox_mock.exam_json(e); end if;
  update public.mock_exams set status = 'archived', archived_at = now(), updated_at = now() where id = e.id returning * into e;
  perform quizbox_core.audit('mock_exam.archive', 'mock_exams', e.id, '{}'::jsonb);
  return quizbox_mock.exam_json(e);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Rounds
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_round_save(p_exam uuid, p_round uuid, p_grade text, p_subject text, p_topic uuid, p_requested integer) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); r public.mock_exam_rounds; g text := quizbox_mock.canon(p_grade); others integer; ok boolean; n integer; keep bigint[];
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if p_requested is null or p_requested < 1 or p_requested > 100 then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  if p_requested > quizbox_mock.num('mock_exams.max_per_topic', 10) then raise exception 'QB_MOCK_TOPIC_CAP: a topic can give at most % questions to one exam', quizbox_mock.num('mock_exams.max_per_topic', 10)::integer using errcode = '22023'; end if;
  if not quizbox_mock.eligible(e.target_grade, g) then raise exception 'QB_MOCK_LEVEL_NOT_ELIGIBLE' using errcode = '22023'; end if;
  select exists (select 1 from public.curriculum_topics t join public.curriculum_nodes nn on nn.id = t.indicator_node_id
                  where t.id = p_topic and t.status = 'ACTIVE' and t.curriculum_id = e.curriculum_id and nn.subject_code = p_subject and quizbox_mock.canon(coalesce(nn.canonical_grade_code, nn.grade_code)) = g) into ok;
  if not ok then raise exception 'QB_MOCK_TOPIC_INVALID' using errcode = '22023'; end if;
  select coalesce(sum(requested), 0)::integer into others from public.mock_exam_rounds where exam_id = e.id and id is distinct from p_round;
  if others + p_requested > e.desired_total then raise exception 'QB_MOCK_OVER_ALLOCATED: % of % questions are already allocated, so at most % can be added', others, e.desired_total, e.desired_total - others using errcode = '22023'; end if;
  begin
    if p_round is null then
      if (select count(*) from public.mock_exam_rounds where exam_id = e.id) >= quizbox_mock.num('mock_exams.max_rounds', 30) then raise exception 'QB_MOCK_TOO_MANY_ROUNDS' using errcode = '22023'; end if;
      insert into public.mock_exam_rounds(exam_id, position, grade_code, subject_code, topic_id, requested)
      values (e.id, coalesce((select max(position) from public.mock_exam_rounds where exam_id = e.id), 0) + 1, g, p_subject, p_topic, p_requested) returning * into r;
    else
      select * into r from public.mock_exam_rounds where id = p_round and exam_id = e.id for update;
      if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
      if r.topic_id <> p_topic then delete from public.mock_exam_questions where round_id = r.id; end if;
      update public.mock_exam_rounds set grade_code = g, subject_code = p_subject, topic_id = p_topic, requested = p_requested where id = r.id returning * into r;
      select count(*) into n from public.mock_exam_questions where round_id = r.id;
      if n > p_requested then   -- fewer questions wanted: keep the first ones chosen
        select array_agg(seq) into keep from (select seq from public.mock_exam_questions where round_id = r.id order by seq limit p_requested) k;
        delete from public.mock_exam_questions where round_id = r.id and not (seq = any (keep));
      end if;
    end if;
  exception when unique_violation then raise exception 'QB_MOCK_TOPIC_IN_USE' using errcode = '22023';
  end;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return quizbox_mock.exam_json(e);
end $fn$;

create or replace function public.qb_mock_round_delete(p_exam uuid, p_round uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  delete from public.mock_exam_rounds where id = p_round and exam_id = e.id;
  if not found then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.mock_exam_rounds set position = x.rn from (select id, row_number() over (order by position)::integer as rn from public.mock_exam_rounds where exam_id = e.id) x where public.mock_exam_rounds.id = x.id and public.mock_exam_rounds.position <> x.rn;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return quizbox_mock.exam_json(e);
end $fn$;

-- Chooses the missing questions of a round from its own topic (difficulty split, one per concept first), never one already in the exam or a duplicate of one. If the topic cannot supply them
-- QB_TOPIC_SHORT is raised and nothing changes.
create or replace function public.qb_mock_round_pick(p_exam uuid, p_round uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); r public.mock_exam_rounds; need integer; pass integer := 0; picked jsonb; qid uuid; v_title text; v_tenant uuid := public.qb_public_tenant_id(); added integer := 0;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  select * into r from public.mock_exam_rounds where id = p_round and exam_id = e.id for update;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select title into v_title from public.curriculum_topics where id = r.topic_id;
  loop
    pass := pass + 1;
    select r.requested - count(*) into need from public.mock_exam_questions where round_id = r.id;
    exit when need <= 0;
    if pass > 3 then raise exception 'QB_TOPIC_SHORT: % cannot supply % more different questions', v_title, need; end if;
    picked := quizbox_topic.pick_for_topic(r.topic_id, v_title, need, null, v_tenant, false, quizbox_mock.taken(e.id));
    for qid in select value::uuid from jsonb_array_elements_text(picked -> 'picked') loop
      insert into public.mock_exam_questions(exam_id, round_id, question_id, picked_by)
      select e.id, r.id, q.id, 'auto' from public.questions q where q.id = qid
         and not exists (select 1 from public.mock_exam_questions s join public.questions q2 on q2.id = s.question_id where s.exam_id = e.id and quizbox_mock.dup_key(q2) = quizbox_mock.dup_key(q));
      if found then added := added + 1; end if;
    end loop;
  end loop;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return jsonb_build_object('added', added, 'exam', quizbox_mock.exam_json(e));
end $fn$;

create or replace function public.qb_mock_round_clear(p_exam uuid, p_round uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if not exists (select 1 from public.mock_exam_rounds where id = p_round and exam_id = e.id) then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.mock_exam_questions where round_id = p_round;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return quizbox_mock.exam_json(e);
end $fn$;

-- The eligible questions of a round's topic, for choosing by hand. Questions the full availability check refuses are not listed.
create or replace function public.qb_mock_round_candidates(p_exam uuid, p_round uuid, p_limit integer default 60, p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); r public.mock_exam_rounds; v_tenant uuid := public.qb_public_tenant_id(); v_taken uuid[] := quizbox_mock.taken(p_exam);
begin
  select * into r from public.mock_exam_rounds where id = p_round and exam_id = e.id;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(x.j order by x.ord) from (
    select row_number() over (order by q.id) as ord, jsonb_build_object('id', q.id, 'question_text', left(q.question_text, 400), 'answer_type', coalesce(q.answer_type, 'SINGLE_CHOICE'), 'marks', q.marks, 'level', l.level,
      'in_round', exists (select 1 from public.mock_exam_questions s where s.round_id = r.id and s.question_id = q.id),
      'blocked', q.id = any (v_taken) and not exists (select 1 from public.mock_exam_questions s where s.round_id = r.id and s.question_id = q.id)) as j
    from quizbox_topic.listable_questions(r.topic_id, v_tenant, false) l join public.questions q on q.id = l.question_id
    where public.qb_question_is_available(q) order by q.id limit least(greatest(coalesce(p_limit, 60), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb);
end $fn$;

-- Replaces the round's questions with exactly these ones, chosen by hand. Each must belong to the round's topic, be available, and not repeat (or duplicate) a question elsewhere in the exam.
create or replace function public.qb_mock_round_set_questions(p_exam uuid, p_round uuid, p_question_ids uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); r public.mock_exam_rounds; qid uuid; v_tenant uuid := public.qb_public_tenant_id(); keys text[] := '{}'; k text; q public.questions;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  select * into r from public.mock_exam_rounds where id = p_round and exam_id = e.id for update;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  p_question_ids := coalesce(p_question_ids, '{}');
  if cardinality(p_question_ids) > r.requested then raise exception 'QB_MOCK_QUESTION_INVALID: % chosen, only % wanted in this round', cardinality(p_question_ids), r.requested using errcode = '22023'; end if;
  delete from public.mock_exam_questions where round_id = r.id;
  select coalesce(array_agg(quizbox_mock.dup_key(q2)), '{}') into keys from public.mock_exam_questions s join public.questions q2 on q2.id = s.question_id where s.exam_id = e.id;
  foreach qid in array p_question_ids loop
    select * into q from public.questions where id = qid;
    if q.id is null or not exists (select 1 from quizbox_topic.listable_questions(r.topic_id, v_tenant, false) l where l.question_id = qid) or not public.qb_question_is_available(q) then raise exception 'QB_MOCK_QUESTION_INVALID' using errcode = '22023'; end if;
    k := quizbox_mock.dup_key(q);
    if k = any (keys) then raise exception 'QB_MOCK_QUESTION_INVALID: a question is repeated or duplicates another in this exam' using errcode = '22023'; end if;
    keys := keys || k;
    insert into public.mock_exam_questions(exam_id, round_id, question_id, picked_by) values (e.id, r.id, qid, 'manual');
  end loop;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return quizbox_mock.exam_json(e);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Review and publish
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_exam_review(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam);
begin
  return jsonb_build_object('exam', quizbox_mock.exam_json(e), 'readiness', quizbox_mock.readiness(e),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('position', x.pos, 'round', x.rpos, 'question_id', x.id, 'question_text', x.question_text, 'answer_type', x.at, 'marks', x.marks, 'grade_code', x.grade_code,
        'subject_code', x.subject_code, 'topic_title', x.title, 'picked_by', x.picked_by, 'available', x.ok) order by x.pos)
      from (select row_number() over (order by r.position, s.seq)::integer as pos, r.position as rpos, q.id, q.question_text, coalesce(q.answer_type, 'SINGLE_CHOICE') as at, q.marks, r.grade_code, r.subject_code, t.title, s.picked_by,
                   public.qb_question_is_available(q) as ok
              from public.mock_exam_questions s join public.mock_exam_rounds r on r.id = s.round_id join public.questions q on q.id = s.question_id join public.curriculum_topics t on t.id = r.topic_id where s.exam_id = e.id) x), '[]'::jsonb),
    'scoring', jsonb_build_object('total_marks', coalesce((select sum(q.marks) from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = e.id), 0),
      'answer_types', coalesce((select jsonb_object_agg(a.at, a.n) from (select coalesce(q.answer_type, 'SINGLE_CHOICE') as at, count(*)::integer as n from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = e.id group by 1) a), '{}'::jsonb),
      'time_limit_minutes', e.time_limit_minutes, 'attempts_allowed', e.attempts_allowed, 'shuffle_questions', e.shuffle_questions));
end $fn$;

create or replace function public.qb_mock_exam_publish(p_exam uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); rd jsonb; v public.mock_exam_versions; v_no integer; v_marks numeric; v_n integer; v_hash text;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if e.version_count > 0 and not e.dirty then raise exception 'QB_MOCK_NO_CHANGES' using errcode = '55000'; end if;
  rd := quizbox_mock.readiness(e);
  if not (rd ->> 'ready')::boolean then raise exception 'QB_MOCK_NOT_READY: %', rd -> 'issues' -> 0 ->> 'code' using errcode = '55000'; end if;
  v_no := e.version_count + 1;
  select count(*)::integer, coalesce(sum(q.marks), 0), md5(string_agg(q.id::text || ':' || coalesce(q.version, 1)::text, ',' order by r.position, s.seq))
    into v_n, v_marks, v_hash from public.mock_exam_questions s join public.mock_exam_rounds r on r.id = s.round_id join public.questions q on q.id = s.question_id where s.exam_id = e.id;
  insert into public.mock_exam_versions(exam_id, version_no, published_by, title, description, purpose, audience, curriculum_id, target_grade, question_count, total_marks, time_limit_minutes, attempts_allowed,
                                        shuffle_questions, instructions, rounds, content_hash)
  values (e.id, v_no, auth.uid(), e.title, e.description, e.purpose, e.audience, e.curriculum_id, e.target_grade, v_n, v_marks, e.time_limit_minutes, e.attempts_allowed, e.shuffle_questions, e.instructions,
          (select coalesce(jsonb_agg(x - 'id' - 'available' - 'available_to_add' - 'shortfall' order by (x ->> 'position')::integer), '[]'::jsonb) from jsonb_array_elements(quizbox_mock.rounds_json(e)) x), v_hash)
  returning * into v;
  insert into public.mock_exam_version_questions(version_id, position, round_position, question_id, question_version, topic_id, grade_code, subject_code, curriculum_node_id, external_id, source_type, source_version, curriculum_reference,
      question_text, option_a, option_b, option_c, option_d, correct_answer, explanation, answer_type, answer_spec, question_content, marks)
  select v.id, row_number() over (order by r.position, s.seq)::integer, r.position, q.id, q.version, r.topic_id, r.grade_code, r.subject_code, q.curriculum_node_id, q.external_question_id, q.source_type, q.source_version, q.curriculum_reference,
         q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.explanation, q.answer_type, q.answer_spec, q.question_content, q.marks
    from public.mock_exam_questions s join public.mock_exam_rounds r on r.id = s.round_id join public.questions q on q.id = s.question_id where s.exam_id = e.id;
  update public.mock_exams set status = 'published', dirty = false, current_version_id = v.id, version_count = v_no, updated_at = now() where id = e.id returning * into e;
  perform quizbox_core.audit('mock_exam.publish', 'mock_exams', e.id, jsonb_build_object('version', v_no, 'questions', v_n));
  return jsonb_build_object('version_id', v.id, 'version_no', v_no, 'question_count', v_n, 'exam', quizbox_mock.exam_json(e));
end $fn$;

revoke all on function public.qb_mock_enabled(), public.qb_mock_author_status(), public.qb_mock_curricula(), public.qb_mock_grades(text), public.qb_mock_subjects(uuid, text), public.qb_mock_topics(uuid, text, text, uuid),
  public.qb_mock_exam_create(jsonb), public.qb_mock_exam_update(uuid, jsonb), public.qb_mock_exam_list(), public.qb_mock_exam_get(uuid), public.qb_mock_exam_delete(uuid), public.qb_mock_exam_archive(uuid),
  public.qb_mock_round_save(uuid, uuid, text, text, uuid, integer), public.qb_mock_round_delete(uuid, uuid), public.qb_mock_round_pick(uuid, uuid), public.qb_mock_round_clear(uuid, uuid),
  public.qb_mock_round_candidates(uuid, uuid, integer, integer), public.qb_mock_round_set_questions(uuid, uuid, uuid[]), public.qb_mock_exam_review(uuid), public.qb_mock_exam_publish(uuid) from public, anon;
grant execute on function public.qb_mock_enabled(), public.qb_mock_author_status(), public.qb_mock_curricula(), public.qb_mock_grades(text), public.qb_mock_subjects(uuid, text), public.qb_mock_topics(uuid, text, text, uuid),
  public.qb_mock_exam_create(jsonb), public.qb_mock_exam_update(uuid, jsonb), public.qb_mock_exam_list(), public.qb_mock_exam_get(uuid), public.qb_mock_exam_delete(uuid), public.qb_mock_exam_archive(uuid),
  public.qb_mock_round_save(uuid, uuid, text, text, uuid, integer), public.qb_mock_round_delete(uuid, uuid), public.qb_mock_round_pick(uuid, uuid), public.qb_mock_round_clear(uuid, uuid),
  public.qb_mock_round_candidates(uuid, uuid, integer, integer), public.qb_mock_round_set_questions(uuid, uuid, uuid[]), public.qb_mock_exam_review(uuid), public.qb_mock_exam_publish(uuid) to authenticated, service_role;

commit;
