-- Repeat-weekly assignments and a due-soon reminder (flag flags.repeat_assignments, default OFF).
-- A teacher saves the shape of a by-subject-and-topic assignment (the same sections the blueprint publisher takes) with a weekday, a time and
-- a number of days to finish. Every week the runner publishes a fresh copy through the existing publisher, acting as that teacher, so market,
-- approval, target and notification rules are exactly those of a hand-published assignment. A week that cannot be published (a topic is short,
-- the class is gone) is skipped and the teacher is told; three skips in a row pause the schedule. The same five-minute run sends each learner
-- one in-app reminder when an assignment is due within a day and they have not handed it in (the bell and phone push carry it; nothing is emailed).
-- Nothing runs while the flag is off. Rollback: supabase/rollback/repeat_assignments.sql.

insert into public.platform_settings(key, value, description) values
  ('flags.repeat_assignments', 'false', 'Teachers can repeat an assignment every week; learners get a due-soon reminder')
on conflict do nothing;

create schema if not exists quizbox_sched;
revoke all on schema quizbox_sched from public, anon, authenticated;

create table if not exists public.assignment_schedules (
  id uuid primary key default gen_random_uuid(),
  teacher_user_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  sections jsonb not null check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) between 1 and 8),
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  mode text not null default 'PRACTICE' check (mode in ('PRACTICE', 'ASSESSMENT')),
  attempts_allowed integer not null default 1 check (attempts_allowed between 1 and 10),
  time_limit_minutes integer not null default 30 check (time_limit_minutes between 1 and 180),
  publish_dow integer not null check (publish_dow between 1 and 7),          -- ISO weekday, 1 = Monday
  publish_time time not null default '16:00',
  due_after_days integer not null default 3 check (due_after_days between 1 and 7),
  tz text not null default 'Africa/Accra',
  active boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_assignment_id uuid references public.assignments(id) on delete set null,
  last_status text check (last_status in ('PUBLISHED', 'SKIPPED', 'MISSED')),
  last_error text,
  fail_streak integer not null default 0,
  runs integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assignment_schedules_due_idx on public.assignment_schedules(next_run_at) where active;
create index if not exists assignment_schedules_teacher_idx on public.assignment_schedules(teacher_user_id, created_at desc);
alter table public.assignment_schedules enable row level security;
revoke all on public.assignment_schedules from anon, authenticated;

-- One reminder per assignment: the claim row is written before anyone is told, so two overlapping runs never remind twice.
create table if not exists public.assignment_reminders_sent (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  sent_at timestamptz not null default now(),
  recipients integer not null default 0
);
alter table public.assignment_reminders_sent enable row level security;
revoke all on public.assignment_reminders_sent from anon, authenticated;

-- The next time a weekday and a local time occur after a moment.
create or replace function quizbox_sched.next_run(p_dow integer, p_time time, p_tz text, p_after timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select min(x.t) from (
    select ((d::date + p_time) at time zone p_tz) as t
    from generate_series((p_after at time zone p_tz)::date, (p_after at time zone p_tz)::date + 7, interval '1 day') d
    where extract(isodow from d)::integer = p_dow) x
  where x.t > p_after;
$$;

create or replace function quizbox_sched.tell(p_user uuid, p_title text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform quizbox_ops.notify(p_user, 'ASSIGNMENT_SCHEDULE', p_title, p_message, '/teacher/assignments/repeating', 'assignment_schedules', null);
exception when others then null;     -- a notification problem never blocks the run
end $$;

-- ---- Teacher functions (the table itself is closed to the browser) --------------------------------------------------------------------------

create or replace function public.qb_schedule_create(
  p_class_id uuid, p_title text, p_description text, p_sections jsonb, p_difficulty text default null,
  p_mode text default 'PRACTICE', p_attempts_allowed integer default 1, p_time_limit_minutes integer default 30,
  p_publish_dow integer default 5, p_publish_time text default '16:00', p_due_after_days integer default 3
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.classes; t time; row_ public.assignment_schedules;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not quizbox_core.flag('flags.repeat_assignments') then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  c := quizbox_topic.class_for_teacher(p_class_id);
  begin t := p_publish_time::time; exception when others then raise exception 'INVALID_SCHEDULE_TIME' using errcode = '22023'; end;
  if (select count(*) from public.assignment_schedules where teacher_user_id = auth.uid() and active) >= 5 then raise exception 'QB_SCHEDULE_LIMIT' using errcode = '53400'; end if;
  -- It has to be publishable today: this raises with the short topic named, exactly as publishing would.
  perform quizbox_topic.blueprint_plan(p_class_id, p_sections, p_difficulty);
  insert into public.assignment_schedules(teacher_user_id, class_id, title, description, sections, difficulty, mode, attempts_allowed, time_limit_minutes,
                                          publish_dow, publish_time, due_after_days, next_run_at)
  values (auth.uid(), c.id, btrim(p_title), coalesce(p_description, ''), p_sections, nullif(p_difficulty, ''), upper(p_mode), p_attempts_allowed, p_time_limit_minutes,
          p_publish_dow, t, p_due_after_days,
          -- The first repeat is at least a day away, so a teacher who publishes now and repeats the same weekday does not send two on the same day.
          quizbox_sched.next_run(p_publish_dow, t, 'Africa/Accra', now() + interval '1 day'))
  returning * into row_;
  return jsonb_build_object('id', row_.id, 'next_run_at', row_.next_run_at);
end $$;

create or replace function public.qb_schedule_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'class_id', s.class_id, 'class_name', k.class_name, 'title', s.title, 'mode', s.mode,
      'subjects', (select coalesce(jsonb_agg(x ->> 'subject'), '[]'::jsonb) from jsonb_array_elements(s.sections) x),
      'total', (select coalesce(sum((x ->> 'quota')::integer), 0) from jsonb_array_elements(s.sections) x),
      'publish_dow', s.publish_dow, 'publish_time', to_char(s.publish_time, 'HH24:MI'), 'due_after_days', s.due_after_days,
      'active', s.active, 'next_run_at', s.next_run_at, 'last_run_at', s.last_run_at, 'last_status', s.last_status, 'last_error', s.last_error, 'runs', s.runs)
    order by s.created_at desc)
    from public.assignment_schedules s join public.classes k on k.id = s.class_id where s.teacher_user_id = auth.uid()), '[]'::jsonb);
end $$;
