create or replace function public.qb_schedule_set_active(p_id uuid, p_active boolean) returns void language plpgsql security definer set search_path = '' as $$
declare s public.assignment_schedules;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into s from public.assignment_schedules where id = p_id and teacher_user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_active then
    if not quizbox_core.flag('flags.repeat_assignments') then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
    if not s.active and (select count(*) from public.assignment_schedules where teacher_user_id = auth.uid() and active) >= 5 then raise exception 'QB_SCHEDULE_LIMIT' using errcode = '53400'; end if;
    -- Resuming never replays the weeks that passed while paused.
    update public.assignment_schedules set active = true, fail_streak = 0, last_error = null,
      next_run_at = quizbox_sched.next_run(publish_dow, publish_time, tz, now()), updated_at = now() where id = p_id;
  else
    update public.assignment_schedules set active = false, updated_at = now() where id = p_id;
  end if;
end $$;

create or replace function public.qb_schedule_delete(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  delete from public.assignment_schedules where id = p_id and teacher_user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- ---- The runner (service role only; the cron route calls it every few minutes) --------------------------------------------------------------

create or replace function quizbox_sched.run_due(p_limit integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.assignment_schedules; prev text := current_setting('request.jwt.claim.sub', true); prev_claims text := current_setting('request.jwt.claims', true); published jsonb; nxt timestamptz;
        n_pub integer := 0; n_skip integer := 0; n_missed integer := 0; msg text; streak integer;
begin
  if not quizbox_core.flag('flags.repeat_assignments') then return jsonb_build_object('enabled', false, 'published', 0, 'skipped', 0, 'missed', 0); end if;
  for s in select * from public.assignment_schedules where active and next_run_at <= now() order by next_run_at
           limit greatest(1, least(coalesce(p_limit, 50), 200)) for update skip locked loop
    nxt := quizbox_sched.next_run(s.publish_dow, s.publish_time, s.tz, now());
    if s.next_run_at < now() - interval '24 hours' then
      -- The runner was down for a day or more: do not send a stale assignment.
      update public.assignment_schedules set next_run_at = nxt, last_status = 'MISSED', last_run_at = now(), updated_at = now() where id = s.id;
      perform quizbox_sched.tell(s.teacher_user_id, 'A weekly assignment was not sent', '"' || s.title || '" could not go out on time. The next one is set for ' || to_char(nxt at time zone s.tz, 'Dy DD Mon HH24:MI') || '.');
      n_missed := n_missed + 1;
      continue;
    end if;
    -- Act as the teacher for this one publish (transaction-local). Both settings are set because auth.uid() reads either.
    perform set_config('request.jwt.claim.sub', s.teacher_user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', s.teacher_user_id, 'role', 'authenticated')::text, true);
    begin
      published := public.qb_publish_blueprint_assignment(s.class_id, left(s.title, 100) || ' · ' || to_char(now() at time zone s.tz, 'DD Mon'), s.description, s.sections, s.difficulty,
                     s.mode, s.attempts_allowed, s.time_limit_minutes, now(), now() + make_interval(days => s.due_after_days), null);
      update public.assignment_schedules set runs = runs + 1, fail_streak = 0, last_status = 'PUBLISHED', last_error = null, last_run_at = now(),
        last_assignment_id = (published ->> 'assignment_id')::uuid, next_run_at = nxt, updated_at = now() where id = s.id;
      perform quizbox_sched.tell(s.teacher_user_id, 'This week''s assignment is out', '"' || s.title || '" was sent to the class. The next one is set for ' || to_char(nxt at time zone s.tz, 'Dy DD Mon HH24:MI') || '.');
      n_pub := n_pub + 1;
    exception when others then
      msg := left(sqlerrm, 300);
      streak := s.fail_streak + 1;
      update public.assignment_schedules set fail_streak = streak, active = (streak < 3), last_status = 'SKIPPED', last_error = msg, last_run_at = now(), next_run_at = nxt, updated_at = now() where id = s.id;
      perform quizbox_sched.tell(s.teacher_user_id, 'A weekly assignment was skipped', '"' || s.title || '" was not sent this week: ' || msg
        || case when streak >= 3 then ' It is now paused; open Repeating assignments to fix it and resume.' else '' end);
      n_skip := n_skip + 1;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(prev, ''), true);
  perform set_config('request.jwt.claims', coalesce(prev_claims, ''), true);
  return jsonb_build_object('enabled', true, 'published', n_pub, 'skipped', n_skip, 'missed', n_missed);
end $$;

-- One reminder to each learner who has not handed in an assignment that is due within a day (and was published at least an hour ago).
create or replace function quizbox_sched.remind_due() returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.assignments; u uuid; n integer; total_a integer := 0; total_r integer := 0; claimed integer;
begin
  if not quizbox_core.flag('flags.repeat_assignments') then return jsonb_build_object('enabled', false, 'assignments', 0, 'reminders', 0); end if;
  for a in select x.* from public.assignments x
           where x.status::text = 'published' and x.due_at > now() and x.due_at <= now() + interval '24 hours'
             and coalesce(x.published_at, x.created_at) <= now() - interval '1 hour'
             and not exists (select 1 from public.assignment_reminders_sent r where r.assignment_id = x.id)
           order by x.due_at limit 200 loop
    insert into public.assignment_reminders_sent(assignment_id) values (a.id) on conflict do nothing;
    get diagnostics claimed = row_count;
    if claimed = 0 then continue; end if;
    n := 0;
    for u in select distinct cm.student_user_id from public.assignment_targets t join public.class_memberships cm on cm.id = t.membership_id
             where t.assignment_id = a.id and t.status::text = 'active' and cm.student_user_id is not null
               and not exists (select 1 from public.attempts at where at.assignment_id = a.id and at.student_user_id = cm.student_user_id and at.submitted_at is not null) loop
      perform quizbox_ops.notify(u, 'ASSIGNMENT_DUE_SOON', 'Due soon: ' || coalesce(a.title, 'Assignment'),
        'Due ' || to_char(a.due_at at time zone 'Africa/Accra', 'Dy DD Mon HH24:MI') || '. It is not finished yet.', '/student/assessments', 'assignments', a.id);
      n := n + 1;
    end loop;
    update public.assignment_reminders_sent set recipients = n where assignment_id = a.id;
    total_a := total_a + 1; total_r := total_r + n;
  end loop;
  return jsonb_build_object('enabled', true, 'assignments', total_a, 'reminders', total_r);
end $$;

create or replace function public.qb_schedules_run(p_limit integer default 50) returns jsonb language sql security definer set search_path = '' as $$
  select quizbox_sched.run_due(p_limit);
$$;
create or replace function public.qb_assignment_reminders_run() returns jsonb language sql security definer set search_path = '' as $$
  select quizbox_sched.remind_due();
$$;

revoke all on function quizbox_sched.next_run(integer, time, text, timestamptz), quizbox_sched.tell(uuid, text, text), quizbox_sched.run_due(integer), quizbox_sched.remind_due() from public, anon, authenticated;
revoke all on function public.qb_schedule_create(uuid, text, text, jsonb, text, text, integer, integer, integer, text, integer), public.qb_schedule_list(),
  public.qb_schedule_set_active(uuid, boolean), public.qb_schedule_delete(uuid), public.qb_schedules_run(integer), public.qb_assignment_reminders_run() from public, anon;
