-- QuizBox question import metadata extension
-- Keeps workbook-level curriculum and commercial metadata during import.

alter table public.questions add column if not exists question_code text;
alter table public.questions add column if not exists batch_id text;
alter table public.questions add column if not exists learning_area_code text;
alter table public.questions add column if not exists learning_area_name text;
alter table public.questions add column if not exists content_standard_code text;
alter table public.questions add column if not exists content_standard_text text;
alter table public.questions add column if not exists indicator_code text;
alter table public.questions add column if not exists indicator_text text;
alter table public.questions add column if not exists difficulty_label text;
alter table public.questions add column if not exists cognitive_level text;
alter table public.questions add column if not exists marks numeric(8,2) not null default 1;
alter table public.questions add column if not exists estimated_time_seconds integer;
alter table public.questions add column if not exists tags text[] not null default array[]::text[];
alter table public.questions add column if not exists source_type text;
alter table public.questions add column if not exists curriculum_reference text;
alter table public.questions add column if not exists validation_status text;
alter table public.questions add column if not exists duplicate_group_id text;
alter table public.questions add column if not exists commercial_status text;
alter table public.questions add column if not exists imported_at timestamptz;
alter table public.questions add column if not exists source_storage_path text;

create unique index if not exists questions_external_question_id_uidx
  on public.questions(external_question_id)
  where external_question_id is not null;

create index if not exists questions_subject_grade_strand_idx
  on public.questions(subject_code, grade, strand_no, substrand_no)
  where status = 'active';

create index if not exists questions_indicator_idx
  on public.questions(indicator_code)
  where status = 'active';

create index if not exists questions_validation_status_idx
  on public.questions(validation_status)
  where status = 'active';