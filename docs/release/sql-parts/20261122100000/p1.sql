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
