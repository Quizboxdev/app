-- Family workspace, phases 9 and 10: what a parent can follow about their children, and what staff can see about families. Read-only; nothing here changes data.
--   public.qb_family_progress(days)                  one line per child the parent may follow: work done, average, work still to do, last activity
--   public.qb_family_child_progress(student, days)   one child: totals, a week-by-week curve, and the latest results with where each piece of work came from (school or family)
--   public.qb_admin_families()                       staff only: family workspaces, linked children, orders and spend, family work, waiting invitations and requests
--   public.qb_admin_family_detail(workspace)         staff only: one family's children, orders and recent family actions (inspect without impersonating)
-- A parent only ever sees a child they are actively linked to with the view_progress permission (checked in the database each time); a revoked link shows nothing at once.
-- Off with the rest of the workspace for parents (flags.family_workspace); the staff views also work when it is off, so staff can see an empty system. Errors: QB_AUTH_REQUIRED, QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN, QB_FORBIDDEN.
-- Additive and idempotent. Rollback: supabase/rollback/family_progress_admin.sql


create or replace function public.qb_family_progress(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); d integer := least(greatest(coalesce(p_days, 30), 7), 365);
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', r.target_user_id, 'name', p.full_name, 'grade_code', sp.grade_code,
      'completed', (select count(*) from public.attempts a where a.student_user_id = r.target_user_id and a.submitted_at is not null and a.submitted_at >= now() - make_interval(days => d)),
      'average', (select round(avg(a.percentage), 1) from public.attempts a where a.student_user_id = r.target_user_id and a.submitted_at is not null and a.submitted_at >= now() - make_interval(days => d)),
      'outstanding', (select count(*) from public.assignment_targets t join public.assignments x on x.id = t.assignment_id where t.student_id = sp.id
                        and not exists (select 1 from public.attempts a where a.assignment_id = x.id and a.student_id = t.student_id and a.submitted_at is not null)),
      'last_activity', (select max(coalesce(a.submitted_at, a.started_at)) from public.attempts a where a.student_user_id = r.target_user_id)) order by p.full_name)
    from public.account_relationships r join public.family_workspaces w on w.id = r.family_workspace_id and w.owner_user_id = uid
    join public.profiles p on p.id = r.target_user_id join public.student_profiles sp on sp.user_id = r.target_user_id
    where r.source_user_id = uid and quizbox_core.family_can(uid, r.target_user_id, 'view_progress')), '[]'::jsonb);
end $fn$;

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

create or replace function public.qb_admin_families() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not (quizbox_core.is_staff() or quizbox_market.is_super()) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object('generated_at', now(),
    'workspaces', (select count(*) from public.family_workspaces),
    'children_linked', (select count(*) from public.account_relationships where family_workspace_id is not null and status = 'active'),
    'requests_waiting', (select count(*) from public.account_relationships where family_workspace_id is not null and status = 'requested'),
    'invitations_waiting', (select count(*) from public.family_invitations where status = 'pending' and expires_at > now()),
    'orders', coalesce((select jsonb_object_agg(s.status, s.c) from (select status, count(*)::integer as c from public.family_orders group by status) s), '{}'::jsonb),
    'paid_minor', coalesce((select sum(total_minor) from public.family_orders where status in ('paid', 'fulfilled')), 0),
    'family_assignments', (select count(*) from public.assignments where source_type = 'family'),
    'families', coalesce((select jsonb_agg(f.j order by f.created_at desc) from (
        select w.created_at, jsonb_build_object('workspace_id', w.id, 'owner', p.full_name, 'email', p.email, 'created_at', w.created_at,
          'children', (select count(*) from public.account_relationships r where r.family_workspace_id = w.id and r.status = 'active'),
          'orders', (select count(*) from public.family_orders o where o.workspace_id = w.id),
          'spent_minor', coalesce((select sum(o.total_minor) from public.family_orders o where o.workspace_id = w.id and o.status in ('paid', 'fulfilled')), 0),
          'assignments', (select count(*) from public.assignments x where x.workspace_id = w.id)) as j
        from public.family_workspaces w join public.profiles p on p.id = w.owner_user_id order by w.created_at desc limit 100) f), '[]'::jsonb));
end $fn$;
