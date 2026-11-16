create or replace function public.qb_family_child_progress(p_student uuid, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); d integer := least(greatest(coalesce(p_days, 30), 7), 365); sp_id uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not quizbox_core.family_can(uid, p_student, 'view_progress') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select id into sp_id from public.student_profiles where user_id = p_student;
  return jsonb_build_object('days', d,
    'completed', (select count(*) from public.attempts a where a.student_user_id = p_student and a.submitted_at >= now() - make_interval(days => d)),
    'average', (select round(avg(a.percentage), 1) from public.attempts a where a.student_user_id = p_student and a.submitted_at >= now() - make_interval(days => d)),
    'best', (select max(a.percentage) from public.attempts a where a.student_user_id = p_student and a.submitted_at >= now() - make_interval(days => d)),
    'outstanding', (select count(*) from public.assignment_targets t join public.assignments x on x.id = t.assignment_id where t.student_id = sp_id
                      and not exists (select 1 from public.attempts a where a.assignment_id = x.id and a.student_id = t.student_id and a.submitted_at is not null)),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('week', w.wk, 'completed', w.c, 'average', w.avg) order by w.wk) from (
        select date_trunc('week', a.submitted_at)::date as wk, count(*)::integer as c, round(avg(a.percentage), 1) as avg
          from public.attempts a where a.student_user_id = p_student and a.submitted_at >= now() - make_interval(days => d) group by 1) w), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('title', y.title, 'percentage', y.percentage, 'submitted_at', y.submitted_at, 'source', y.source) order by y.submitted_at desc) from (
        select x.title, a.percentage, a.submitted_at, x.source_type as source from public.attempts a join public.assignments x on x.id = a.assignment_id
         where a.student_user_id = p_student and a.submitted_at is not null order by a.submitted_at desc limit 10) y), '[]'::jsonb));
end $fn$;
