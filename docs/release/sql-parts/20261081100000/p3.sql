create or replace function public.qb_family_assignments() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
    select a.created_at, jsonb_build_object('assignment_id', a.id, 'title', a.title, 'grade_code', coalesce(a.grade_code, a.grade::text), 'due_at', a.due_at, 'published_at', a.published_at,
      'question_count', a.question_count, 'mode', a.mode,
      'children', coalesce((select jsonb_agg(jsonb_build_object('student_id', sp.user_id, 'name', p.full_name,
          'status', case when exists (select 1 from public.attempts at where at.assignment_id = a.id and at.student_id = t.student_id and at.submitted_at is not null) then 'done'
                         when exists (select 1 from public.attempts at where at.assignment_id = a.id and at.student_id = t.student_id) then 'started' else 'not_started' end,
          'percentage', (select max(at.percentage) from public.attempts at where at.assignment_id = a.id and at.student_id = t.student_id and at.submitted_at is not null)) order by p.full_name)
        from public.assignment_targets t join public.student_profiles sp on sp.id = t.student_id join public.profiles p on p.id = sp.user_id
        where t.assignment_id = a.id and quizbox_core.family_can(uid, sp.user_id, 'view_progress')), '[]'::jsonb)) as j
    from public.assignments a where a.workspace_id = w and a.source_type = 'family' order by a.created_at desc limit 50) x), '[]'::jsonb);
end $fn$;

revoke all on function quizbox_core.assignment_source() from public, anon, authenticated;
revoke all on function public.qb_family_class(text), public.qb_family_assignments() from public, anon, authenticated;
grant execute on function public.qb_family_class(text), public.qb_family_assignments() to authenticated;

notify pgrst, 'reload schema';
