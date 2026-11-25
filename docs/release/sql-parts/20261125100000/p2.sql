-- Every count is worked out on its own: a table that is missing on this database gives null for that count only.
create or replace function quizbox_stats.compute_queues() returns jsonb
language plpgsql set search_path = '' as $fn$
declare m record; n bigint; res jsonb := '{}'::jsonb;
begin
  for m in select * from quizbox_stats.metrics_content() union all select * from quizbox_stats.metrics_operations() loop
    begin
      execute m.query into n;
      res := res || jsonb_build_object(m.key, jsonb_build_object('n', n, 'cap', m.cap));
    exception when others then
      res := res || jsonb_build_object(m.key, jsonb_build_object('n', null, 'cap', m.cap));
    end;
  end loop;
  return res;
end $fn$;

-- All question figures from one pass over the small index (the earlier version read every question row three times), by class and by subject within each class.
-- The class is the market class code. SHS questions leave the older national grade column empty (it has no "SHS 1" label), so grouping on that column alone
-- showed all SHS years as one bar with no name. "SHS 1" is read as SHS1, and the older code B10 is the same year.
create or replace function quizbox_stats.compute_content() returns jsonb
language plpgsql set search_path = '' as $fn$
declare s jsonb; b integer;
begin
  begin
    select jsonb_build_object(
      'live', coalesce(sum(c.live), 0), 'in_review', coalesce(sum(c.rev), 0),
      'by_class', coalesce(jsonb_agg(jsonb_build_object('grade', c.grade, 'live', c.live, 'in_review', c.rev, 'subjects', c.subjects) order by c.grade), '[]'::jsonb)) into s
      from (select x.grade, sum(x.live)::integer as live, sum(x.rev)::integer as rev,
                   jsonb_agg(jsonb_build_object('subject', x.subject, 'live', x.live, 'in_review', x.rev) order by x.live + x.rev desc, x.subject) as subjects
              from (select coalesce(case k.code when 'B10' then 'SHS1' else k.code end, 'Not set') as grade, coalesce(max(q.subject_name), 'Not set') as subject,
                           count(*) filter (where q.status::text = 'active' and q.validation_status = 'approved')::integer as live,
                           count(*) filter (where q.validation_status = 'review' and q.status::text <> 'archived')::integer as rev
                      from public.questions q
                     cross join lateral (select upper(replace(coalesce(nullif(q.canonical_grade_code, ''), nullif(q.source_grade_code, ''), q.grade::text), ' ', '')) as code) k
                     group by 1, lower(q.subject_name)) x
             where x.live > 0 or x.rev > 0
             group by x.grade) c;
  exception when others then return jsonb_build_object('content', null);
  end;
  begin
    select count(*) into b from public.question_load_batches l where l.status in ('LOADED', 'PARTIAL')
      and not exists (select 1 from public.question_batch_approvals a where a.batch_id = l.id and a.status = 'ACTIVE');
  exception when others then b := null;
  end;
  return jsonb_build_object('content', s || jsonb_build_object('batches_waiting', b));
end $fn$;

create or replace function quizbox_stats.compute_people(p_days integer) returns jsonb
language plpgsql set search_path = '' as $fn$
declare d0 date := (now())::date - (p_days - 1); res jsonb := '{}'::jsonb; s jsonb;
begin
  begin  -- users
    select jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'new_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
      'new_prev_7d', (select count(*) from public.profiles where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
      'by_role', coalesce((select jsonb_object_agg(r.role, r.c) from (select role::text as role, count(*)::integer as c from public.profiles group by role) r), '{}'::jsonb),
      'signups', coalesce((select jsonb_agg(jsonb_build_object('week', g.d::date, 'added', coalesce(x.c, 0)) order by g.d)
                             from generate_series(d0, (now())::date, interval '1 day') as g(d)
                             left join (select created_at::date as day, count(*)::integer as c from public.profiles where created_at >= d0 group by 1) x on x.day = g.d::date), '[]'::jsonb)) into s;
    res := res || jsonb_build_object('users', s);
  exception when others then res := res || jsonb_build_object('users', null);
  end;
  begin  -- learning activity
    select jsonb_build_object(
      'attempts_7d', (select count(*) from public.attempts where started_at >= now() - interval '7 days'),
      'attempts_prev_7d', (select count(*) from public.attempts where started_at >= now() - interval '14 days' and started_at < now() - interval '7 days'),
      'attempts_total', (select count(*) from public.attempts),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('week', g.d::date, 'started', coalesce(a.c, 0), 'submitted', coalesce(b.c, 0)) order by g.d)
                           from generate_series(d0, (now())::date, interval '1 day') as g(d)
                           left join (select started_at::date as day, count(*)::integer as c from public.attempts where started_at >= d0 group by 1) a on a.day = g.d::date
                           left join (select submitted_at::date as day, count(*)::integer as c from public.attempts where submitted_at >= d0 group by 1) b on b.day = g.d::date), '[]'::jsonb)) into s;
    res := res || jsonb_build_object('learning', s);
  exception when others then res := res || jsonb_build_object('learning', null);
  end;
  begin  -- markets by stage
    select coalesce(jsonb_object_agg(m.st, m.c), '{}'::jsonb) into s from (select status::text as st, count(*)::integer as c from public.markets group by status) m;
    res := res || jsonb_build_object('markets', s);
  exception when others then res := res || jsonb_build_object('markets', null);
  end;
  return res;
end $fn$;

-- Calculates one snapshot and stores it. The key is 'queues', 'content' or 'people:<days>'.
create or replace function quizbox_stats.refresh(p_key text) returns void
language plpgsql set search_path = '' as $fn$
declare t0 timestamptz := clock_timestamp(); v jsonb;
begin
  v := case split_part(p_key, ':', 1)
         when 'queues' then quizbox_stats.compute_queues()
         when 'content' then quizbox_stats.compute_content()
         when 'people' then quizbox_stats.compute_people(split_part(p_key, ':', 2)::integer)
       end;
  insert into quizbox_stats.snapshots as s (section, payload, computed_at, took_ms)
  values (p_key, v, clock_timestamp(), (extract(epoch from clock_timestamp() - t0) * 1000)::integer)
  on conflict (section) do update set payload = excluded.payload, computed_at = excluded.computed_at, took_ms = excluded.took_ms;
end $fn$;

-- For the scheduler: refreshes what the dashboard shows by default. One failure does not stop the rest.
create or replace function quizbox_stats.refresh_all() returns void
language plpgsql set search_path = '' as $fn$
declare k text;
begin
  foreach k in array array['queues', 'content', 'people:30'] loop
    begin
      if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('qb_admin_live:' || k)) then perform quizbox_stats.refresh(k); end if;
    exception when others then raise warning 'qb_admin_live refresh of % failed: %', k, sqlerrm;
    end;
  end loop;
end $fn$;

revoke all on all functions in schema quizbox_stats from public, anon, authenticated;
