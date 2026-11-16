-- Admin dashboard figures in one read-only call: qb_admin_dashboard(days).
-- Users (total, new this week against the week before, by role, daily sign-ups), learning activity (attempts started and submitted per day, this week against the week before),
-- content (live and waiting for review, by class; batches waiting for approval), queues (support requests, markets still being set up), markets by stage, and the school directory.
-- Staff only (owner, admin or super admin). Reads only; changes no data. Each section is computed on its own: if a table is missing on an environment, that section is null and the others still answer.
-- Additive and idempotent. Rollback: supabase/rollback/admin_dashboard.sql.

create or replace function public.qb_admin_dashboard(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare
  d0 date := (now())::date - (least(greatest(coalesce(p_days, 30), 7), 90) - 1);
  res jsonb := jsonb_build_object('generated_at', now(), 'days', least(greatest(coalesce(p_days, 30), 7), 90));
  s jsonb;
begin
  if auth.uid() is null or not (quizbox_core.is_staff() or quizbox_market.is_super()) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;

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

  begin  -- content
    select jsonb_build_object(
      'live', (select count(*) from public.questions where status::text = 'active' and validation_status = 'approved'),
      'in_review', (select count(*) from public.questions where validation_status = 'review' and status::text <> 'archived'),
      'by_class', coalesce((select jsonb_agg(jsonb_build_object('grade', c.grade, 'live', c.live, 'in_review', c.rev) order by c.grade)
                              from (select grade::text as grade, count(*) filter (where status::text = 'active' and validation_status = 'approved')::integer as live,
                                           count(*) filter (where validation_status = 'review' and status::text <> 'archived')::integer as rev
                                      from public.questions group by grade) c where c.live > 0 or c.rev > 0), '[]'::jsonb),
      'batches_waiting', (select count(*) from public.question_load_batches b where b.status in ('LOADED', 'PARTIAL')
                            and not exists (select 1 from public.question_batch_approvals a where a.batch_id = b.id and a.status = 'ACTIVE'))) into s;
    res := res || jsonb_build_object('content', s);
  exception when others then res := res || jsonb_build_object('content', null);
  end;

  begin  -- queues
    select jsonb_build_object(
      'support_open', (select count(*) from public.support_requests where status = 'open'),
      'support_waiting_for_user', (select count(*) from public.support_requests where status = 'waiting_for_user'),
      'support_new_7d', (select count(*) from public.support_requests where created_at >= now() - interval '7 days')) into s;
    res := res || jsonb_build_object('queues', s);
  exception when others then res := res || jsonb_build_object('queues', null);
  end;

  begin  -- markets
    select coalesce(jsonb_object_agg(m.st, m.c), '{}'::jsonb) into s from (select status::text as st, count(*)::integer as c from public.markets group by status) m;
    res := res || jsonb_build_object('markets', s);
  exception when others then res := res || jsonb_build_object('markets', null);
  end;

  begin  -- school directory
    select jsonb_build_object('listed', (select count(*) from public.school_directory where status = 'approved'), 'waiting', (select count(*) from public.school_directory where status = 'pending')) into s;
    res := res || jsonb_build_object('schools', s);
  exception when others then res := res || jsonb_build_object('schools', null);
  end;

  return res;
end $fn$;

revoke all on function public.qb_admin_dashboard(integer) from public, anon, authenticated;
grant execute on function public.qb_admin_dashboard(integer) to authenticated;
